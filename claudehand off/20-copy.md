# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2 — regular-file cp recognition and resolution

Complete and tested; waiting for review and commit. Previous mv resolver
committed at `fe5f0de`; archived in [19-move-resolution.md](19-move-resolution.md).
Working tree was clean at the start.

### Solved

- `src/shell/copy.ts`: pure two-operand parseCopy with optional single -i/-n
  and --. Unknown flags, recursion, backup, links, metadata-preservation,
  directory overrides and -f remain unknown. Force can remove the destination.
- `src/commands/resolve-copy.ts`: regular-file-to-file destination create/edit
  only. Never reports source reads as writes or source deletion.
- `src/commands/resolve-file-pair.ts`: extracted shared read-only validation
  from resolveMove; both operations use the same containment and metadata checks.
- `resolve-move.ts` keeps its prior contract: source delete plus destination
  writes. Existing move tests passed after extraction.
- Refuse directory operands, leaf links, hard links, same-file aliases, missing
  sources/parents, escapes and unresolved paths. Preserve destination aliases.
- No-clobber/interactive describe potential writes, never guaranteed skips.
- Agreements-and-enforcement rules guided conservative semantics. Official GNU
  source and explicit limits documented in docs/agreements.md.

### Checks and failures

- 52 new copy tests passed, including temp-filesystem resolution checks.
- 388 targeted tests passed across 9 files: copy 52, move resolver 21, write
  resolver 25, move parser 56, tee 59, redirect 64, sed 45, package manager 58,
  and generated context 8.
- Build, source/test type checks and final diff whitespace check passed.
- No implementation/test failures. No full-suite rerun for these unwired
  helpers; prior full-suite counts remain historical.

### Limits

Regular-file-to-file only. Read sources outside the repository are deliberately
refused too. Recursive/directory copies, leaf links, force and other options
remain unsupported. Platform/filesystem-specific metadata side effects are not
established by this subset. Executable identity and filesystem races remain
integration concerns; resolution is not an atomic sandbox or proof of success.

No command execution or file-content reads by resolution, no settings/log
writes, and no Bash hook integration. Temporary fixtures alone are written
by tests. Originals remain unchanged and new targets remain absent.

## Remaining work — separate milestones

1. rm and the read-only allowlist.
2. Shell-check integration: unknown non-read-only commands ask
   "Can't tell what this writes." No broad approval.
3. Starting-tree snapshot and per-call PostToolUse diff.

Sprint 1 still owed: retrospective, three-screen prototype, interactive
two-minute ask check. Earlier work archived in 01–19; see docs/sprint-1-review.md.

Changes uncommitted. No staging, commit, push, PR, user-settings change,
dependency installation or worktree cleanup. Codex stops for Vedant.
