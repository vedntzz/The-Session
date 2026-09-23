# Sprint handoff

Updated: 23 September 2026. Implement one small milestone, test, update this
handoff, then stop for Vedant to review and commit. Never stage or commit.

## Current milestone: Sprint 2, Sun 27 — mv request parsing

Complete and tested; waiting for review and commit. Tee committed at
`bdf67d0`; archived in [17-tee-recognition.md](17-tee-recognition.md).
Working tree was clean at the start.

### Solved

- `src/shell/move.ts`: pure `parseMove(command)`, returning a typed move
  request or unknown. Not a resolved write set.
- Exactly two literal operands; optional single -f, -i or -n and optional --
  before operands. Preserve source, destination and overwrite mode.
- Reject multiple sources, combined/repeated flags, backup options, target
  directory overrides, unknown flags, shell expansion/chaining/redirection,
  malformed syntax, control characters and /dev operands.
- Do not flatten source deletion into an ordinary output path or guess whether
  the destination is a directory. No filesystem reads or commands executed.
- Existing parsers, shared tokenizer, CLI, hook and signed records unchanged.
- Agreements-and-enforcement rules guided explicit uncertainty; GNU source
  and unresolved-move contract are documented in docs/agreements.md.

### Checks and failures

- 56 new move tests passed.
- 290 targeted tests passed across move (56), tee (59), redirection (64),
  sed (45), package-manager/tokenizer (58) and generated context (8).
- Build, source/test type checks and final diff whitespace check passed.
- No implementation/test failures. No full-suite rerun for this isolated,
  unwired parser; earlier full-suite results remain historical.

### Important limits

This completes request parsing only, not safe mv write recognition. A move
can remove the source and write a different destination than its final operand
when that operand is a directory. A directory source can affect a whole tree.
A parsed request must remain unresolved until metadata determines the relevant
operations; never feed it to the check as a complete path list.

Next move milestone: read-only resolution, conservatively refusing unsupported
directory/symlink cases, preserving source deletion and destination create/edit.
No runtime permission, successful move or sandbox guarantee is claimed.

## Remaining work — separately reviewed

1. Finish mv resolution, then cp, rm and the read-only allowlist.
2. Shell-check integration: unknown non-read-only commands ask
   "Can't tell what this writes." No broad approval.
3. Starting-tree snapshot and per-call PostToolUse diff.

Sprint 1 still owed: retrospective, three-screen prototype, interactive
two-minute ask check. Earlier work archived in 01–17; see docs/sprint-1-review.md.

Current changes uncommitted. No staging, commit, push, PR, user-settings change,
dependency installation or worktree cleanup. Codex stops for Vedant.
