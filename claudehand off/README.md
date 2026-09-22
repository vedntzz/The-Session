# Sprint handoff

Updated: 22 September 2026. Work one feature at a time, test it, then stop for
Vedant to review and commit. Codex does not commit or start the next feature
until Vedant asks.

## Current step: agreement review screen

**Complete and tested; waiting for Vedant to review and commit.**

The preceding immutable-record step is committed as `d7346f4`.
[Its complete handoff and failure history](01-agreement-record.md).

### Solved in this step

- `session start "<intent>" --scope <paths...> --review`: explicit agreement
  review before starting.
- `session prime "<intent>" --seed <paths...> --start --review`: display the
  proposal's evidence and original scope, then review accepted terms. A
  replacement `--scope` changes only the accepted list.
- A line-oriented screen shows intent, original proposal when present, accepted
  paths, actions, sensitive paths and policy. All paths remain visible.
- Edit each field before acceptance. Lists use JSON to preserve spaces and
  commas in paths. Empty input keeps a field; `[]` clears a list. Invalid
  edits retain the last valid draft.
- Only typing `accept` starts. Enter, `yes` and unknown choices do not.
  Cancel, EOF or interruption writes no record and creates no signing key.
- New drafts visibly start with create/edit actions, no sensitive paths, and
  record policy; nothing is accepted until the explicit acceptance choice.
- Prime abstentions require a nonempty replacement scope before acceptance.
- Check start conditions before prompting, and again after acceptance. Capture
  HEAD and the dirty baseline after review, so changes during the review are
  correctly recorded as pre-existing work.
- Interactive input and output are required. Reject incompatible passive/debt
  flags and `prime --review` without `--start`.
- Existing noninteractive starts and passive hooks retain their behavior.
- Reuse semantic colours and safe record-text rendering. Release signal/input
  listeners when review ends. No raw terminal mode or cursor codes added.

### Files changed

- `src/commands/review.ts`: review controller, terminal lifecycle, validation
  and the start-at-acceptance workflow.
- `src/render/agreement.ts`: pure review renderer with every accepted term.
- `src/commands/start.ts`: shared start preflight and agreement confirmation.
- `src/program/start.ts`, `src/program/prime.ts`, `src/program/options.ts`:
  interactive flag wiring and an injectable terminal for tests.
- `src/render/prime.ts`: reuse existing evidence output without telling a
  developer already reviewing to rerun the command.
- `test/review.test.ts`: review, cancellation, input validation, terminal
  safety, Prime acceptance, signed storage and changes while reviewing.
- `Readme.md`, `docs/agreements.md`, `CHANGELOG.md`: usage and limitations.
- `docs/context.md`: refreshed with the existing generator and its test run.

### Checks, failures and results

- First typecheck and focused screen/Prime tests: passed (36 tests).
- After adding acceptance-time race/baseline coverage: build and typecheck
  passed; 79 focused tests passed across review, start, Prime workflow and Prime.
- Real terminal smoke test in an isolated temporary repository: edited paths
  (including a filename with a comma and space), changed policy to ask, accepted
  and started. `session verify` confirmed the record's hash and signature.
- Generator's regression suite: **1,497 passed across 45 files**, recorded in
  the refreshed `docs/context.md`.
- Context checks after generation: **8 passed**. The process handle was no
  longer available when this conversation resumed, so the context checks were
  explicitly rerun rather than assuming the generator's final exit status.
- **Final total: 1,505 passing tests across 46 files**, including 21 new review
  tests. Build and source/test typecheck passed.
- Staged and unstaged whitespace checks passed (`git diff --check` and
  `git diff --cached --check`).
- No implementation or test failure encountered in this step. Verification is
  complete; no outstanding failure remains.

All feature changes remain uncommitted on `master`. `CHANGELOG.md` was already
staged when verification resumed; that staging was preserved. Codex stops here
for Vedant to review and commit, then explicitly request the next feature.

### Deliberate limits

Policy is **recorded only** in this version. This screen does not install a
hook or enforce permissions. It says this before acceptance and in the start
confirmation. The next feature implements enforcement.

External proposal ingestion remains unexposed; this review refuses external
proposals rather than mislabelling them as Prime. The record already has
proposer metadata, but external terms need a separate input/review design
before they can be exposed. No model is called.

No dependency, user configuration or storage migration was added. No project
commit, push, PR or worktree cleanup was performed.

## What is left

After Vedant commits this screen, two main build
milestones remain:

1. Opt-in PreToolUse enforcement for Edit, Write and MultiEdit. Map tool input
   to accepted actions and paths; test policy, malformed input, path resolution,
   sensitive paths and timeout behavior. Update the screen's recorded-only
   wording once the actual enforcement capability exists.
2. End-to-end flow, hook latency measurement, final review and retrospective.

Other sprint items still need verification or integration:

- Locate the Saturday three-screen prototype, or build it if still missing.
- Review/integrate Claude's resize fix and changelog work in
  `/Users/vedant/dev-session-ui`.
- Review/integrate hook research from `docs/hook-capabilities` (`2a06865`,
  `/Users/vedant/dev-session-hook`).
- Vedant owns commits. PRs and stale worktree/branch cleanup remain separate
  from the current feature; existing worktrees are preserved.

Monday's command consolidation and v1 boundary are already on master at
`224fd81` (PR #3). Prototype completion is unverified, so no overall sprint
completion percentage is claimed.
