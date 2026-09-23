# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Mon 28 (part 1) — one resolver for a shell command

Complete and tested; waiting for review and commit. The zsh step was committed
as `9889fff`; its handoff is archived in [23-zsh.md](23-zsh.md). Monday's
integration is split: this part is the resolver, the next wires it to the hook.

### Solved

- `src/commands/resolve-shell.ts`: `resolveShellCommand(command, cwd, repo,
  dialect?)` → `resolved` (writes, possibly empty), `unknown` or `blocked`.
  Asks all eight recognizers (read-only, package manager, sed, redirect, tee,
  mv, cp, rm); exactly one must claim the command, else unknown — two claims
  would be two readings, never a guess. `ShellWrites` paths resolve from the
  command's directory through `resolveFileWrite`; move/copy/remove through
  their resolvers. One blocked path blocks the command.
- `platformSedDialect()`: macOS → BSD syntax, otherwise GNU. A GNU sed on PATH
  falls under the stated PATH limit.
- Docs: resolver paragraph in `docs/agreements.md`, layout line in
  `Claude.md`/`AGENTS.md`, `docs/context.md` regenerated.

### Checks

- 26 new tests (`test/resolve-shell.test.ts`) against a temporary repo: every
  recognizer end to end, a subdirectory cwd, ten unknown commands, sed dialect
  in both directions, three blocked cases, and that nothing on disk changes.
  Passed on first run.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,141 passed across 60 files**, plus
  8 context tests (2,149 total; 2,123 before).

## Remaining Sprint 2 work — separate milestones

1. Mon 28 part 2: `hook check` accepts the Bash payload (`tool_input.command`),
   calls `resolveShellCommand`, decides each write as for Edit/Write; unknown
   under ask/deny policy → `ask` "Can't tell what this writes."; blocked →
   deny; matcher gains `Bash` (a repeat `--enforce` install repairs it);
   review screen and start line stop saying shell commands are not checked.
2. Starting-tree snapshot and per-call PostToolUse diff (Tue 29, Wed 30).
3. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
