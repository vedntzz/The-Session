# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestones: `--repo` rename, and per-call records (Wed 30, part 2)

Complete and tested; waiting for review and commit. Tree states were committed
as `7db73ba`; archived in [28-tree-state.md](28-tree-state.md). Vedant's
decisions (23 September): option (a), a record for every call; our own counter;
overlapping calls marked on both records with nothing attributed; rename
`--enforce`; handoffs out of commits; Claude.md/AGENTS.md/context committed apart.

### 1. `--enforce` → `--repo`

Names where the hooks go (this repository's `.claude/settings.local.json`),
not that they block. Unreleased, so no alias: `--enforce` is now an unknown
option (exit 1). Functions renamed to `installRepoHooks`, `uninstallRepoHooks`,
`repoSettingsFile`, `RepoHookOptions`. Updated across src, tests, README,
CHANGELOG, `docs/agreements.md`, parking lot, both skills (both copies) and
`evidence/enforce-e2e.mjs`. Handoff archives keep the old name.

### 2. Per-call records (storage only; hooks are part 3)

- `src/tool-calls.ts` (pure): `ToolCallStart {callId, n, tool, before}`,
  `ToolCallEnd {callId, n, tool, files: [{path, blob|null}], changed,
  overlapping, unpaired?}`, `startFor`, `endFor`, `filesChanged`,
  `foldToolCall`, `nextCallNumber`.
- `n`: this session's own counter, assigned under the log lock. `callId` only
  pairs a start with its end; nothing reads the transcript.
- Every call is recorded; a no-op is `changed: false, files: []`.
- Overlap: at a call's end, any other call that started and was still open,
  or ended after this one started, makes it `overlapping` — so both are
  marked. Overlapping and unpaired calls record `changed: null`, `files: []`.
  **Deviation from the requested shape:** `changed` is `boolean | null`, since
  those two cases cannot honestly say true or false.
- `src/git/blobs.ts`: `treeStateAfter(before, commit, cwd)` hashes paths the
  before named that are now back at HEAD, so a revert has a real blob and is
  never read as "absent". `filesChanged` throws rather than guess if one is missing.
- Store: `writeRecord` accepts a builder run under the lock;
  `recordCallStart`/`recordCallEnd` use it. The fold turns the two event
  records into `Session.toolCalls` by log order and ignores any `toolCalls`
  value in a record; `updateSession` refuses all three keys. Hashes and paths
  only.
- Docs: record type and layout in `Claude.md`/`AGENTS.md`, sync-and-chain skill
  (both copies), `docs/context.md` regenerated.

### Checks

- Rename: 194 tests across hook, start, review and check-write passed; built
  CLI installs with `--repo`, rejects `--enforce`, help text updated.
- 14 new tests (`test/tool-calls.test.ts`): pure numbering, no-op, revert,
  overlap (interleaved and nested, both marked), sequential not marked,
  unpaired, missing after-path refused; recorded: change/no-op/revert in
  order, three concurrent starts get 1–3, interleaved ends both overlapping on
  disk, no content in the log, signatures verify, patches refused, forged
  field ignored, unknown session refused. Passed on first run.
- `npm run build` and typecheck passed. Full suite: **2,196 passed across 64
  files** (2,182 before).

## Remaining Sprint 2 work — separate milestones

1. Per-call diff part 3: `session hook before`/`after` (PreToolUse/PostToolUse,
   every tool, registered by `--repo`) calling `recordCallStart`/`recordCallEnd`
   with `treeStateSince`/`treeStateAfter`; silent, never blocking; and
   `week <id> --full` printing "changed during tool call N".
2. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
