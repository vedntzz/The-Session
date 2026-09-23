# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Wed 30 (part 1) — tree states and their difference

Complete and tested; waiting for review and commit. The stop step was committed
as `546f5a3`; archived in [27-stop-snapshot.md](27-stop-snapshot.md).
Wednesday's per-call diff is split in three; this is the first part.

### Solved

- `src/git/blobs.ts`: `treeStateSince(commit, cwd)` — every path differing from
  `commit` (changed, deleted, untracked) → blob id, `null` if not a regular
  file; absent means as at `commit`. It is `changedFilesSince` + `endStateOf`,
  i.e. exactly what `start` records as `baselineState` (tested equal).
- `src/tree-state.ts`: pure `treeStateChanges(before, after)` — sorted paths
  whose state differs, where "as at the start commit" (absent), "not a file"
  (`null`) and a blob are three distinct states. Uses `Object.hasOwn`, so a
  path named `constructor` is safe (tested).
- Layout line in `Claude.md`/`AGENTS.md`; `docs/context.md` regenerated.

### Checks

- 6 new tests (`test/tree-state.test.ts`): four pure; one real repo taking five
  consecutive looks (edit, create + delete, revert to HEAD, nothing) and
  checking each difference names only that step's paths; one proving the
  start snapshot equals `treeStateSince` at start.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,174 passed across 62 files**, plus
  8 context tests (2,182 total; 2,176 before).

### Design for parts 2 and 3 (for review before they are built)

- **Part 2, storage:** one appended record per tool call in the session's own
  signed log — call number, tool name, the paths it changed, and the tree
  state after it (hashes only, never content). The fold collects them into an
  ordered list instead of overwriting. Log-format change, so under the
  sync-and-chain rules; no second store.
- **Part 3, hook and view:** a `PostToolUse` hook (`session hook after`) takes a
  look, diffs it against the previous call's state (call 1 against
  `baselineState`), and appends only when something changed — a call that
  changed nothing writes nothing. `week <id> --full` prints "changed during
  tool call N". Registered with `--enforce`, per repository.
- **Open question — what N counts.** Writing only when a call changed
  something means nothing on disk counts the calls that did not, so N would
  not be the true call number. Options: (a) a small record per call, every
  call (exact count, log grows per call); (b) number only calls that changed
  something, and say so; (c) take the position from the transcript the hook
  payload names. Decide before part 2.

## Remaining Sprint 2 work — separate milestones

1. Per-call diff parts 2 (storage in the signed log) and 3 (PostToolUse hook
   and "changed during tool call N" view) — design above.
2. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
