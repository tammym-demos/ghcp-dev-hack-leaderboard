# Workshop Leaderboard Kit

Self-contained event-repository template for an optional workshop-wide leaderboard covering Foundations, Agentic, and Advanced.

## What this kit does

- Accepts participant submissions through a GitHub Issue Form.
- Rebuilds standings on issue open, edit, label change, reopen, close, or manual dispatch.
- Uses a deterministic Node.js 22 script only; no Copilot, no AI scoring, no runtime npm dependencies.
- Publishes a sanitized GitHub Pages artifact containing:
  - `index.html`
  - `leaderboard.json`
  - `.nojekyll`

  The workflow deploys this artifact to the event repository's GitHub Pages site
  after every accepted issue event or manual run.

## Included files

- `leaderboard.config.json` - event state, labels, alias policy, and scoring rules.
- `RUNBOOK.md` - facilitator runbook for pre-event setup, in-event projection and verification, and close-out.
- `.github/ISSUE_TEMPLATE/leaderboard-submission.yml` - participant submission form.
- `.github/workflows/publish-leaderboard.yml` - read-only intake/build job and
  separately permissioned GitHub Pages deployment job.
- `src/leaderboard.mjs` - parser, validator, aggregator, and renderer.
- `src/build-leaderboard.mjs` - CLI builder for GitHub API or local fixtures.
- `test/leaderboard.test.mjs` - Node built-in tests.
- `fixtures/sample-issues.json` - synthetic local sample data using aliases only.
- `package.json` - pinned Node engine and no-install scripts.

## Repository setup

1. Copy this kit into the root of a dedicated event repository.
2. In **Settings → Pages**, select **GitHub Actions** as the source.
3. Keep the default labels or update all three places together:
   - `leaderboard.config.json`
   - `.github/ISSUE_TEMPLATE/leaderboard-submission.yml`
   - `.github/workflows/publish-leaderboard.yml`
4. Set the event id and event state in `leaderboard.config.json`.
5. If you change the event id, update the issue-form title and placeholder in `.github/ISSUE_TEMPLATE/leaderboard-submission.yml`.

## Event configuration

`leaderboard.config.json` controls:

- `event.id` - required value participants must submit.
- `event.state` - `open` or `closed`.
- `labels.submission` - issue label used for leaderboard intake.
- `labels.verified` - facilitator-only verification label.
- `pages.refreshSeconds` - optional projected-board reload interval, 15-600 seconds.
- `aliasPolicy` - length and allowed characters.

The kit enforces these approved workshop rules:

- Modules: Foundations, Agentic, Advanced
- Core points: `0-50`; Foundations accepts `5` point increments because its clues are worth 5, 10, 10, 10, and 15 points, while Agentic and Advanced accept `10` point increments
- Bonus points: `0-10`, in `10` point increments
- Completion requires `40` core points per module
- Maximum cumulative score: `180`

## Participant operations

- Participants submit one issue per module with the issue form.
- Participants do **not** need `workflow_dispatch`, `repository_dispatch`, personal access tokens, or other repository credentials.
- To correct a score, edit the existing issue.
- Deduplication is by issue author + event id + module using the latest updated valid submission.

## Facilitator operations

- Apply the `verified-score` label only after verifying a module score.
- Change `event.state` to `closed` when the event is finished.
- Winners are only announced after the event is closed.
- If two or more eligible participants tie for the highest verified cumulative total, they are co-winners.

## Privacy and safety

Published output excludes:

- author login
- author id
- issue body
- issue evidence
- real names
- email
- employer
- repository content

Only sanitized alias and score data are published. If two different participants use the same public alias, the builder withholds those records from the public standings until the conflict is corrected.

All rendered HTML is escaped. The workflow uses least privilege, avoids `pull_request_target`, avoids eval, avoids shell interpolation of issue text, and never writes commits back to the repository.

## Correction and withdrawal

- Correction: edit the existing submission issue for that module.
- Withdrawal: close the latest valid submission issue for that module.
- Re-entry: reopen the withdrawn issue or edit/create a newer valid submission.

If duplicates exist, only the latest updated valid submission for the same author, event id, and module is used.

## Archive guidance

After the event:

1. Set `event.state` to `closed`.
2. Run the workflow once manually with `workflow_dispatch`.
3. Download and retain the final Pages artifact if you need an event archive.
4. Optionally disable the issue form or archive the repository.

## Local usage

Run from the kit root:

```powershell
npm test
npm run build
```

The kit's tests also run from the workshop repository root as part of `pnpm test`,
or on their own with `pnpm test:leaderboard-kit`.

Manual sample build:

```powershell
node src/build-leaderboard.mjs --config leaderboard.config.json --input fixtures/sample-issues.json --out sample-site
```

GitHub API build:

```powershell
node src/build-leaderboard.mjs --config leaderboard.config.json --out site
```

The GitHub API mode reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and optional `GITHUB_API_URL`.

## Updating pinned GitHub Action SHAs

This kit pins actions by immutable commit SHA. To refresh a pin, resolve the trusted major tag through the GitHub API, then update only the SHA:

```powershell
gh api repos/actions/checkout/git/ref/tags/v4
gh api repos/actions/setup-node/git/ref/tags/v4
gh api repos/actions/upload-pages-artifact/git/ref/tags/v3
gh api repos/actions/configure-pages/git/ref/tags/v5
gh api repos/actions/deploy-pages/git/ref/tags/v4
```

Use the returned `object.sha` values in `.github/workflows/publish-leaderboard.yml`.
