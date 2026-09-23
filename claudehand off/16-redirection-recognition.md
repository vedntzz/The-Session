# Sprint handoff

Updated: 23 September 2026. One small feature, test, handoff, stop for Vedant
to review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Sun 27 — stdout redirection recognition

Complete and tested; waiting for review and commit. The sed milestone was
committed at `760f75d` and is archived in [15-sed-recognition.md](15-sed-recognition.md).
Working tree was clean at the start.

### Solved

- `src/shell/redirect.ts`: pure `redirectWrites(command)`.
- Recognizes one trailing stdout > with a single literal target for bare
  redirection, echo or colon. Handles adjacent syntax, quoted targets,
  quoted > characters and literal quote concatenation.
- Returns only the target path, never output content; no commands or file
  writes are performed. Does not infer create versus edit.
- Unknown programs remain unknown even when their redirection is obvious:
  recognizing one target must not hide other writes by that program.
- Rejects multiple/input/append/clobber redirects, numeric descriptors,
  shell expansion/chaining/pipes, malformed syntax, control characters,
  and /dev targets with possible socket/descriptor semantics.
- Existing simpleWords, package-manager and sed behavior unchanged.
- Agreements-and-enforcement rules guided conservative recognition.
  Syntax source and limitations documented in docs/agreements.md.

### Tests and failures

- 64 redirection tests plus 45 sed, 58 package-manager/tokenizer and 8 context
  tests: 175 targeted tests passed.
- Source/test type checks, build and diff whitespace check passed.
- No implementation/test failures. Initial official-document fetch timed out;
  official Bash documentation was found through search afterward.
- No full-suite rerun for this isolated unwired parser; previous full-suite
  results remain historical.

### Limits

Only a small stdout-redirection subset is recognized, not a shell grammar.
Assumes ordinary builtins, not replacement functions/aliases. Shell environment
and executable identity need attention during integration. Paths are unresolved;
filesystem aliases, devices and create/edit classification belong to later
resolution. Arbitrary commands are not partially reported as safe.

No Bash matcher or hook integration changed, no settings/log writes, no command
execution, and no claim that any recognized write succeeded.

## Remaining work — separate milestones

1. Rest of Sun 27: tee, mv, cp, rm and a read-only allowlist.
2. Mon 28: wire shell commands into check; unknown non-read-only commands ask
   "Can't tell what this writes." No broad approval.
3. Codex days: starting-tree snapshot, then per-call PostToolUse diff.

Sprint 1 still owed: retrospective, three-screen prototype, interactive
two-minute ask check. Earlier work is archived in 01–15; Sprint 1 review
is docs/sprint-1-review.md.

Current changes uncommitted. No staging, commit, push, PR, user-settings change,
dependency installation or worktree cleanup. Stop for Vedant.
