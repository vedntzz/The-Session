# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Tue 29 — the starting-tree snapshot

Complete and tested; waiting for review and commit. The shell check was
committed as `e6a1759`; archived in [25-shell-check.md](25-shell-check.md).
The plan gave this day to Codex; Vedant asked Claude to start it.

### Why

`stop` subtracts every path dirty at start (`computeReality`), so a session
that edits a file the developer had already changed leaves no trace. The
snapshot is what makes that detectable. This step captures it; using it at
stop changes a measurement and is the next step (measurement-rules applies).

### Solved

- New optional field `baselineState?: Record<string, string | null>` — blob id
  per baseline path at start (modified, untracked; `null` for deleted or not a
  regular file). `{}` for a clean tree, so absent still means "older record".
- Taken in `openingFacts` with `endStateOf` (the hashing `stop` uses for
  `endState`), right after `baseline`; manual and passive starts share it.
- Creating record only: `SessionPatch` omits it, `refusePatch` refuses it, the
  fold keeps the creating record's value against forged later lines. No record
  version bump, no backfill. Hashes only; no content stored.
- Docs: record type in `Claude.md`/`AGENTS.md`; sync-and-chain skill (both
  copies) lists it among creation-only fields; `docs/context.md` regenerated.

### Checks

- 9 new tests (`test/baseline-state.test.ts`): modified/untracked/deleted
  hashed against `git hash-object`; `{}` for clean; passive start; value is the
  start state, not later; no content in the log; patch refused; forged line
  ignored with and without a snapshot; signed and verifies.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,161 passed across 61 files**, plus
  8 context tests (2,169 total; 2,160 before). No existing test changed.

## Remaining Sprint 2 work — separate milestones

1. Use the snapshot at stop: a baseline path whose blob changed during the
   session counts in reality (measurement-rules; decide how views show it).
2. Per-call PostToolUse diff, "changed during tool call N" (Wed 30).
3. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
