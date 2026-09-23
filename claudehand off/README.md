# Sprint handoff

Updated: 23 September 2026. One small feature, test, handoff, then stop for
Vedant to review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Sun 27 — tee recognition

Complete and tested; waiting for review and commit. Previous redirection
milestone committed at `67b85a7`; archived in
[16-redirection-recognition.md](16-redirection-recognition.md).
Working tree was clean at the start.

### Solved

- `src/shell/tee.ts`: pure `teeWrites(command)`, named output paths or unknown.
- Recognizes one standalone tee with literal operands; includes every named
  output and deduplicates identical names.
- Supports -a/-i and their combinations, --append/--ignore-interrupts before
  operands, and -- before operands for dash-prefixed filenames.
- Append and overwrite name the same potential targets; no filesystem action
  classification or success is inferred.
- Bare tee, empty or '-' operands, /dev targets, unknown options, flags after
  operands, pipelines, redirects, expansion and compound shell syntax remain
  unknown. A pipeline is never reduced to only tee's targets.
- Reuses simpleWords unchanged. Existing parsers, CLI and hook matcher unchanged.
- Agreements-and-enforcement skill guided conservative recognition.
  GNU tee documentation and limits are recorded in docs/agreements.md.

### Tests and failures

- 59 new tee tests passed.
- 234 targeted tests passed across tee (59), redirection (64), sed (45),
  package-manager/tokenizer (58), and generated context (8).
- Build, source/test type checks and final diff whitespace check passed.
- No implementation or test failures. No full-suite rerun for this isolated,
  unwired parser; prior full-suite counts are historical.

### Limits

Named operands only: tee also writes to inherited stdout, whose destination
cannot be established from this command string. Executable identity, aliases,
functions, symlinks, device detection and create/edit classification remain
integration concerns. Some long options are GNU-specific; a recognized target
is not a promise of successful execution.

No commands executed by the parser, no settings/log writes, no Bash hook
integration, and no claim that any recognized write occurred.

## Remaining work — separate reviewed milestones

1. Rest of Sun 27: mv, cp, rm and the read-only allowlist.
2. Mon 28: shell-check integration; unknown non-read-only commands ask
   "Can't tell what this writes." No broad approval.
3. Codex days: starting-tree snapshot, then per-call PostToolUse diff.

Sprint 1 still owed: retrospective, three-screen prototype, interactive
two-minute ask check. Earlier work archived in 01–16; see docs/sprint-1-review.md.

Changes are uncommitted. No staging, commit, push, PR, user-settings change,
dependency installation or worktree cleanup. Codex stops for Vedant.
