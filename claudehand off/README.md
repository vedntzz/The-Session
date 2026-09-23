# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2 — rm recognition and resolution

Complete and tested; waiting for review and commit. The cp step was committed
as `a859c6c`; its handoff is archived in [20-copy.md](20-copy.md).

### Solved

- `src/shell/remove.ts`: pure `parseRemove`. One `rm`, one or more literal
  operands, optionally one `-f` or `-i`, optional `--`. Unknown: `-r`, `-R`,
  `-rf`, `--recursive`, `-d`, combined or long options, options after
  operands, empty operands, `/dev` targets, and anything `simpleWords` refuses.
- `src/commands/resolve-remove.ts`: read-only `resolveRemove`. Every operand
  becomes `delete`, parent aliases kept, deduplicated. A missing operand is
  still a `delete` (it may exist when the command runs; `-f` only silences
  the error). Leaf symlinks are blocked (`symlink-operand`): rm removes the
  link, not the target. Directories, hard links, escapes and unresolved paths
  are blocked by `resolveFileWrite`; one blocked operand blocks the command.
- Docs: rm paragraphs in `docs/agreements.md`. The `Claude.md`/`AGENTS.md`
  layout now lists all shell files — sed, redirect, tee, move, copy and remove
  had not been added by the previous steps. `docs/context.md` regenerated.

### Checks

- 43 new tests (`test/remove.test.ts`): parser cases, and resolution against
  temporary files including aliases, links, hard links, a directory, an escape,
  and the decision each deletion produces. Passed on first run.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,040 passed across 58 files**, plus
  8 context tests (2,048 total; 2,005 before).

### Limits

Regular files only; directories are never enumerated. Not wired to the hook.

## Remaining Sprint 2 work — separate milestones

1. The read-only allowlist (Sun 27): commands known to write nothing tracked.
2. Shell-check integration (Mon 28): unknown non-read-only commands ask
   "Can't tell what this writes." Grants scoped to one operation.
3. Starting-tree snapshot and per-call PostToolUse diff (Tue 29, Wed 30).
4. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
