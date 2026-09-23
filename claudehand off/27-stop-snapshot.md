# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2 — stop uses the starting snapshot

Complete and tested; waiting for review and commit. The snapshot capture was
committed as `a539b6b`; archived in [26-snapshot.md](26-snapshot.md).

### Decision (Claude's recommendation; Vedant did not choose)

A file dirty at start that the session changed counts in `reality` like any
other path — so in drift if outside scope, and in `endState` for outcome and
survival. No separate category: it would be a second view of one fact. Say so
if the other option (show it apart) is wanted instead.

### Solved

- `src/commands/stop.ts`: pure `baselineChanges(baselineState, now)` — baseline
  paths whose blob differs from the snapshot (edited again, deleted,
  recreated, or put back to HEAD). `computeReality` takes them as a third
  argument, adds them back, and returns sorted. `stopSession` hashes only the
  baseline paths, with the `workingBlobs` that made the snapshot.
- A record without `baselineState` measures exactly as before; nothing is
  inferred or backfilled ("absent is not nought").
- Docs: new "Reality and the starting snapshot" section in the
  measurement-rules skill (both copies; description names `stop.ts`'s
  reality); record comments in `Claude.md`/`AGENTS.md`; CHANGELOG entry (user
  visible: figures change for new sessions); `docs/context.md` regenerated.

### Checks

- 7 new tests: six through start → edit → stop (edited again and drifting,
  untouched dirty file still excluded, reverted to HEAD, deleted, deleted-then-
  recreated plus untracked-then-removed, legacy record unchanged) and one pure.
  The 48 existing stop tests passed unchanged.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,168 passed across 61 files**, plus
  8 context tests (2,176 total; 2,169 before).

## Remaining Sprint 2 work — separate milestones

1. Per-call PostToolUse diff, "changed during tool call N" (Wed 30).
2. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
