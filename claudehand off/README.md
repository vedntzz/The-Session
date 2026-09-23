# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2 — regular-file mv resolution

Complete and tested; waiting for review and commit. Previous move-parser
milestone committed at `96c658e`; archived in
[18-move-request.md](18-move-request.md). Working tree was clean at the start.

### Solved

- `src/commands/resolve-move.ts`: read-only `resolveMove(request, cwd, repo)`.
- Reuses resolveFileWrite for trusted-root containment, canonical agreement
  paths, aliases and file metadata. No shell execution or content reads.
- Returns source delete operations separately from destination create/edit.
  Checks must evaluate every operation, not just the destination.
- Parent-directory aliases preserve requested and physical paths on both sides.
- Refuses directory operands, leaf symlinks, hard-linked files, missing source,
  missing destination parents, same-file aliases, escapes and invalid paths.
- Keeps potential effects for interactive/no-clobber rather than claiming
  the operation will run or that a possible skip is a guaranteed no-op.
- Unknown requests and errors return static blocked reasons.
- Agreements-and-enforcement rules guided operation separation and conservative
  refusal. No CLI, hook matcher, record shape or existing resolver changes.

### Verification and failures

- 21 new resolver tests passed, using temporary files, aliases, links and
  agreement decisions. Verify originals unchanged and new targets absent.
- 143 targeted tests passed: move resolver 21, write resolver 25, move parser 56,
  agreement decisions 33, generated context 8.
- Build, source/test type checks and final diff whitespace check passed.
- No implementation/test failures. No full-suite rerun for this isolated,
  unwired resolver; earlier full-suite counts remain historical.

### Limits

Only regular-file-to-file moves are resolved. Moves into directories and
directory sources remain unsupported, not partially enumerated. Leaf links
are refused because renaming a link differs from writing through it.

Resolution is a snapshot, not an atomic sandbox. Filesystem changes can race
the later move. A resolved result describes potential operations, not success.
This is still not integrated into Bash interception; no permission is granted.

## Remaining work — separately reviewed

1. cp, rm and the read-only allowlist; retain conservative unsupported cases.
2. Shell-check integration: unknown non-read-only commands ask
   "Can't tell what this writes." No broad approval.
3. Starting-tree snapshot and per-call PostToolUse diff.

Sprint 1 still owed: retrospective, three-screen prototype, interactive
two-minute ask check. Earlier work archived in 01–18; see docs/sprint-1-review.md.

Current changes uncommitted. No staging, commit, push, PR, user-settings change,
dependency installation or worktree cleanup. Codex stops for Vedant.
