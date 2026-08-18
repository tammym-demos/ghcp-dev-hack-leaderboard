import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateLeaderboard,
  buildHtml,
  createPublicReport,
  escapeHtml,
  evaluateIssueSubmission,
  parseIssueFormBody,
  validateConfig
} from '../src/leaderboard.mjs';
import config from '../leaderboard.config.json' with { type: 'json' };

function makeIssue({
  number,
  login,
  userId,
  state = 'open',
  labels = ['leaderboard-submission'],
  updatedAt,
  createdAt = updatedAt,
  eventId = config.event.id,
  alias = 'Sample Alias',
  module = 'Foundations',
  core = '40',
  bonus = '10',
  includeSelfReport = true,
  includePrivacy = true,
  extraSections = ''
}) {
  const selfReportValue = includeSelfReport
    ? '- [x] I confirm this is my own self-reported score for the selected module and event.'
    : '- [ ] I confirm this is my own self-reported score for the selected module and event.';
  const privacyValue = includePrivacy
    ? '- [x] I understand the published leaderboard includes only my opt-in alias and sanitized score data, and facilitators may verify or withhold entries.'
    : '- [ ] I understand the published leaderboard includes only my opt-in alias and sanitized score data, and facilitators may verify or withhold entries.';

  return {
    number,
    state,
    updated_at: updatedAt,
    created_at: createdAt,
    labels: labels.map((name) => ({ name })),
    user: {
      login,
      id: userId
    },
    body: `### Event ID

${eventId}

### Opt-in Alias

${alias}

### Module

${module}

### Core Points

${core}

### Bonus Points

${bonus}

### Self-Report Acknowledgement

${selfReportValue}

### Privacy Acknowledgement

${privacyValue}
${extraSections}`
  };
}

function cloneConfig(overrides = {}) {
  return structuredClone({
    ...config,
    ...overrides
  });
}

test('rejects non-positive score increments', () => {
  for (const step of [0, -10]) {
    const invalidConfig = cloneConfig({
      modules: config.modules.map((module, index) => index === 0
        ? { ...module, core: { ...module.core, step } }
        : module)
    });

    assert.throws(
      () => validateConfig(invalidConfig),
      /foundations core band is invalid/
    );
  }
});

test('rejects missing or invalid alias patterns', () => {
  const missingPatternConfig = cloneConfig({
    aliasPolicy: {
      minLength: config.aliasPolicy.minLength,
      maxLength: config.aliasPolicy.maxLength
    }
  });
  const invalidPatternConfig = cloneConfig({
    aliasPolicy: {
      ...config.aliasPolicy,
      pattern: '['
    }
  });

  assert.throws(
    () => validateConfig(missingPatternConfig),
    /aliasPolicy\.pattern must be a non-empty regular expression/
  );
  assert.throws(
    () => validateConfig(invalidPatternConfig),
    /aliasPolicy\.pattern must be a valid regular expression/
  );
});

test('aggregates provisional and verified standings', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig(),
    issues: [
      makeIssue({ number: 1, login: 'participant-001', userId: 1001, updatedAt: '2026-08-01T10:00:00Z', alias: 'Mergewell One', module: 'Foundations', core: '40', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 2, login: 'participant-001', userId: 1001, updatedAt: '2026-08-01T11:00:00Z', alias: 'Mergewell One', module: 'Agentic', core: '50', bonus: '0', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 3, login: 'participant-001', userId: 1001, updatedAt: '2026-08-01T12:00:00Z', alias: 'Mergewell One', module: 'Advanced', core: '40', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 4, login: 'participant-002', userId: 1002, updatedAt: '2026-08-01T13:00:00Z', alias: 'Relay Two', module: 'Foundations', core: '50', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 5, login: 'participant-002', userId: 1002, updatedAt: '2026-08-01T14:00:00Z', alias: 'Relay Two', module: 'Agentic', core: '40', bonus: '10' }),
      makeIssue({ number: 6, login: 'participant-002', userId: 1002, updatedAt: '2026-08-01T15:00:00Z', alias: 'Relay Two', module: 'Advanced', core: '50', bonus: '0', labels: ['leaderboard-submission', 'verified-score'] })
    ]
  });

  assert.equal(report.provisionalStandings[0].alias, 'Relay Two');
  assert.equal(report.provisionalStandings[0].totalScore, 160);
  assert.equal(report.verifiedStandings[0].alias, 'Mergewell One');
  assert.equal(report.verifiedStandings[0].verifiedTotalScore, 150);
  assert.equal(report.verifiedStandings[0].eligibleForWinner, true);
  assert.equal(report.verifiedStandings[1].eligibleForWinner, false);
  assert.deepEqual(report.winners, []);
});

test('enforces caps, increments, headings, and acknowledgements', () => {
  const evaluated = evaluateIssueSubmission(
    makeIssue({
      number: 20,
      login: 'participant-003',
      userId: 1003,
      updatedAt: '2026-08-01T10:00:00Z',
      alias: 'bad<script>',
      module: 'Unknown',
      core: '35',
      bonus: '15',
      eventId: 'wrong-event',
      includePrivacy: false,
      extraSections: `

### Employer

Contoso`
    }),
    cloneConfig()
  );

  assert.equal(evaluated.valid, false);
  assert.ok(evaluated.reasons.some((reason) => reason.includes('Event id')));
  assert.ok(evaluated.reasons.some((reason) => reason.includes('Alias')));
  assert.ok(evaluated.reasons.some((reason) => reason.includes('Module')));
  assert.ok(evaluated.reasons.some((reason) => reason.includes('Core points')));
  assert.ok(evaluated.reasons.some((reason) => reason.includes('Bonus points')));
  assert.ok(evaluated.reasons.some((reason) => reason.includes('Privacy acknowledgement')));
});

test('deduplicates by latest updated valid submission and supports withdrawal by close', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig(),
    issues: [
      makeIssue({ number: 30, login: 'participant-004', userId: 1004, updatedAt: '2026-08-01T10:00:00Z', alias: 'Runner Four', module: 'Foundations', core: '30', bonus: '10' }),
      makeIssue({ number: 31, login: 'participant-004', userId: 1004, updatedAt: '2026-08-01T11:00:00Z', alias: 'Runner Four', module: 'Foundations', core: '35', bonus: '10' }),
      makeIssue({ number: 32, login: 'participant-004', userId: 1004, updatedAt: '2026-08-01T12:00:00Z', alias: 'Runner Four', module: 'Foundations', core: '40', bonus: '10' }),
      makeIssue({ number: 33, login: 'participant-004', userId: 1004, updatedAt: '2026-08-01T13:00:00Z', alias: 'Runner Four', module: 'Foundations', core: '40', bonus: '10', state: 'closed' })
    ]
  });

  assert.equal(report.summary.selectedModuleSubmissions, 1);
  assert.equal(report.summary.withdrawnModuleSubmissions, 1);
  assert.equal(report.provisionalStandings.length, 0);
});

test('withholds alias conflicts and excludes author identifiers and unknown body sections', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig(),
    issues: [
      makeIssue({ number: 40, login: 'participant-005', userId: 1005, updatedAt: '2026-08-01T10:00:00Z', alias: 'Shared Alias', module: 'Foundations', core: '40', bonus: '10', extraSections: `

### Evidence

Screenshot reference` }),
      makeIssue({ number: 41, login: 'participant-006', userId: 1006, updatedAt: '2026-08-01T10:05:00Z', alias: 'Shared Alias', module: 'Foundations', core: '50', bonus: '0' })
    ]
  });
  const html = buildHtml(report);
  const json = JSON.stringify(createPublicReport(report));

  assert.equal(report.summary.withheldParticipants, 2);
  assert.equal(report.provisionalStandings.length, 0);
  assert.equal(report.verifiedStandings.length, 0);
  assert.ok(!html.includes('participant-005'));
  assert.ok(!html.includes('participant-006'));
  assert.ok(!html.includes('Screenshot reference'));
  assert.ok(!html.includes('Shared Alias'));
  assert.ok(!json.includes('1005'));
  assert.ok(!json.includes('1006'));
});

test('announces co-winners only after event close and requires all verified completed modules', () => {
  const closedConfig = cloneConfig({
    event: {
      ...config.event,
      state: 'closed'
    }
  });
  const report = aggregateLeaderboard({
    config: closedConfig,
    issues: [
      makeIssue({ number: 50, login: 'participant-007', userId: 1007, updatedAt: '2026-08-01T10:00:00Z', alias: 'Tie Alpha', module: 'Foundations', core: '50', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 51, login: 'participant-007', userId: 1007, updatedAt: '2026-08-01T11:00:00Z', alias: 'Tie Alpha', module: 'Agentic', core: '50', bonus: '0', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 52, login: 'participant-007', userId: 1007, updatedAt: '2026-08-01T12:00:00Z', alias: 'Tie Alpha', module: 'Advanced', core: '40', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 53, login: 'participant-008', userId: 1008, updatedAt: '2026-08-01T10:00:00Z', alias: 'Tie Beta', module: 'Foundations', core: '40', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 54, login: 'participant-008', userId: 1008, updatedAt: '2026-08-01T11:00:00Z', alias: 'Tie Beta', module: 'Agentic', core: '50', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 55, login: 'participant-008', userId: 1008, updatedAt: '2026-08-01T12:00:00Z', alias: 'Tie Beta', module: 'Advanced', core: '50', bonus: '0', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 56, login: 'participant-009', userId: 1009, updatedAt: '2026-08-01T10:00:00Z', alias: 'Not Eligible', module: 'Foundations', core: '30', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 57, login: 'participant-009', userId: 1009, updatedAt: '2026-08-01T11:00:00Z', alias: 'Not Eligible', module: 'Agentic', core: '50', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] }),
      makeIssue({ number: 58, login: 'participant-009', userId: 1009, updatedAt: '2026-08-01T12:00:00Z', alias: 'Not Eligible', module: 'Advanced', core: '50', bonus: '10', labels: ['leaderboard-submission', 'verified-score'] })
    ]
  });

  assert.equal(report.winners.length, 2);
  assert.deepEqual(
    report.winners.map((winner) => winner.alias),
    ['Tie Alpha', 'Tie Beta']
  );
  assert.ok(report.verifiedStandings.find((row) => row.alias === 'Not Eligible' && !row.eligibleForWinner));
});

test('escapes HTML output', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig({
      pages: {
        title: 'Results <Open & Closed>',
        description: 'Safe & "sanitized" leaderboard'
      }
    }),
    issues: [makeIssue({ number: 60, login: 'participant-010', userId: 1010, updatedAt: '2026-08-01T10:00:00Z', alias: 'Safe Alias', module: 'Foundations', core: '40', bonus: '0' })]
  });
  const html = buildHtml(report);

  assert.ok(html.includes('Results &lt;Open &amp; Closed&gt;'));
  assert.ok(html.includes('Safe &amp; &quot;sanitized&quot; leaderboard'));
  assert.equal(escapeHtml(`<'">&`), '&lt;&#39;&quot;&gt;&amp;');
});

test('parses only known headings', () => {
  const sections = parseIssueFormBody(`### Event ID

${config.event.id}

### Employer

Hidden

### Module

Foundations

### Core Points

40

### Bonus Points

10

### Opt-in Alias

Visible Alias

### Self-Report Acknowledgement

- [x] ok

### Privacy Acknowledgement

- [x] ok`);

  assert.equal(sections.get('Employer'), undefined);
  assert.equal(sections.get('Opt-in Alias'), 'Visible Alias');
});

test('accepts every achievable Foundations core total', () => {
  for (const core of ['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50']) {
    const evaluated = evaluateIssueSubmission(
      makeIssue({
        number: 70,
        login: 'participant-011',
        userId: 1011,
        updatedAt: '2026-08-01T10:00:00Z',
        alias: 'Clue Runner',
        module: 'Foundations',
        core,
        bonus: '0'
      }),
      cloneConfig()
    );

    assert.deepEqual(evaluated.reasons, [], `Foundations core ${core} must be accepted`);
    assert.equal(evaluated.valid, true);
    assert.equal(evaluated.completed, Number(core) >= 40);
  }
});

test('rejects 5-point core totals for 10-point increment modules', () => {
  for (const module of ['Agentic', 'Advanced']) {
    const evaluated = evaluateIssueSubmission(
      makeIssue({
        number: 71,
        login: 'participant-012',
        userId: 1012,
        updatedAt: '2026-08-01T10:00:00Z',
        alias: 'Clue Runner',
        module,
        core: '45',
        bonus: '0'
      }),
      cloneConfig()
    );

    assert.equal(evaluated.valid, false);
    assert.ok(evaluated.reasons.some((reason) => reason.includes('Core points must use 10-point increments')));
  }
});

test('ranks a 45-point Foundations submission above a 40-point submission', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig(),
    issues: [
      makeIssue({ number: 72, login: 'participant-013', userId: 1013, updatedAt: '2026-08-01T10:00:00Z', alias: 'Sharp Eye', module: 'Foundations', core: '45', bonus: '0' }),
      makeIssue({ number: 73, login: 'participant-014', userId: 1014, updatedAt: '2026-08-01T10:05:00Z', alias: 'Steady Hand', module: 'Foundations', core: '40', bonus: '0' })
    ]
  });

  assert.equal(report.summary.invalidIssues, 0);
  assert.deepEqual(
    report.provisionalStandings.map((row) => [row.alias, row.totalScore]),
    [['Sharp Eye', 45], ['Steady Hand', 40]]
  );
});

test('renders a bounded projection refresh and rejects an out-of-range value', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig(),
    issues: [makeIssue({ number: 80, login: 'participant-015', userId: 1015, updatedAt: '2026-08-01T10:00:00Z', alias: 'Board Watcher', module: 'Foundations', core: '40', bonus: '0' })]
  });

  assert.ok(buildHtml(report).includes('<meta http-equiv="refresh" content="60">'));

  const withoutRefresh = aggregateLeaderboard({
    config: cloneConfig({ pages: { title: 'Board', description: 'Standings' } }),
    issues: []
  });
  assert.equal(withoutRefresh.pages.refreshSeconds, undefined);
  assert.ok(!buildHtml(withoutRefresh).includes('http-equiv="refresh"'));

  assert.throws(
    () => validateConfig(cloneConfig({ pages: { title: 'Board', description: 'Standings', refreshSeconds: 5 } }), 'config'),
    /refreshSeconds/
  );
});

test('renders one participant-facing board without operator telemetry', () => {
  const report = aggregateLeaderboard({
    config: cloneConfig(),
    issues: [
      makeIssue({ number: 90, login: 'participant-020', userId: 1020, updatedAt: '2026-08-01T10:00:00Z', alias: 'Front Runner', module: 'Foundations', core: '50', bonus: '10' }),
      makeIssue({ number: 91, login: 'participant-021', userId: 1021, updatedAt: '2026-08-01T10:01:00Z', alias: 'Second Wind', module: 'Foundations', core: '40', bonus: '0' })
    ]
  });
  const html = buildHtml(report);

  assert.equal(html.match(/<table/g).length, 1, 'the page shows a single merged board');
  assert.ok(!html.includes('Build summary'), 'operator telemetry stays out of the page');
  assert.ok(!html.includes('Issues scanned'));
  assert.ok(!html.includes('Provisional standings'));
  assert.ok(!html.includes('Withheld'));
  assert.ok(html.includes('&#129351;'), 'first place earns a medal');
  assert.ok(html.includes('/ 180'), 'totals are shown against the maximum');
  assert.ok(html.includes('id="find-input"'), 'participants can find themselves');
  assert.ok(html.includes('2 players on the board'));
  assert.ok(html.includes('data-alias="front runner"'));
});

test('reports a generated timestamp and a welcoming empty board', () => {
  const empty = aggregateLeaderboard({ config: cloneConfig(), issues: [] });
  const html = buildHtml(empty);

  assert.ok(typeof empty.generatedAt === 'string' && !Number.isNaN(Date.parse(empty.generatedAt)));
  assert.equal(createPublicReport(empty).generatedAt, empty.generatedAt);
  assert.ok(html.includes(`datetime="${empty.generatedAt}"`), 'the page states when it was built');
  assert.ok(html.includes('Be the first'), 'an empty board invites a first submission');
  assert.ok(!html.includes('<table'));
});
