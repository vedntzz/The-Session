# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Mon 28 (part 2) — shell commands are checked

Complete and tested; waiting for review and commit. Part 1 (the resolver) was
committed as `9205285`; archived in [24-resolve-shell.md](24-resolve-shell.md).
This closes Monday 28's item.

### Solved

- `src/capture/adapters/claude-bash.ts`: `parseClaudeBash` → `{ cwd, command }`
  for `tool_name: "Bash"`; another tool is unsupported, a missing command is
  invalid (deny). Command and description are never stored or echoed.
- `src/commands/check-write.ts`: tries the Edit/Write parser, then Bash.
  Shell commands go through `resolveShellCommand`: resolved writes are decided
  as edits (extracted into `decide`); `unknown` under ask/deny → `ask` "Can't
  tell what this writes. Review the command before it runs."; `blocked` →
  deny; `record` silent. Unsupported tools still silent without a repository.
- `CHECK_HOOK.matcher` → `Edit|Write|MultiEdit|Bash`. An older install reads
  as not registered; a repeat `--enforce` install moves it (tested).
- Review screen: "…for Edit, Write, MultiEdit and shell commands; a shell
  command the check cannot read is asked about."
- **Correction to part 1:** `platformSedDialect` picked sed syntax from the OS,
  against GPT's documented rule "Do not infer the executable's dialect from
  the OS". Replaced by `sedEitherDialect`: known only when GNU and macOS
  readings both succeed, checking the union. `sed -i -e 's/a/b/' f` now checks
  `f` and `f-e` (macOS's backup); `sed -i ''` and GNU-only `sed -i` are asked.
- Docs: `docs/agreements.md` "Shell commands" rewritten for live behaviour and
  every "not wired" line removed; README, CHANGELOG entry, both skills (both
  copies), layout line; `docs/context.md` regenerated.

### Checks

- New: 10 shell-command check tests, 1 matcher-repair test, sed tests
  rewritten for both dialects. Two existing tests updated (old matcher string;
  Bash no longer the example of an unsupported tool).
- Real Claude Code run (`claude -p`, Haiku, Bash only) under a deny agreement
  for edits under `src/`: `echo b > src/a.txt` ran; `echo hello > notes.txt`
  denied with the agreement reason; `touch src/new.txt` asked and, with no one
  to answer under `-p`, did not run. Neither file exists. $0.03.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,152 passed across 60 files**, plus
  8 context tests (2,160 total; 2,149 before).

### For Vedant

Any repository that already ran `session hook install --enforce` needs it run
again to add `Bash` to the matcher. Every Bash call now starts the check
(~190 ms). Under `claude -p`, an `ask` means the command does not run.

## Remaining Sprint 2 work — separate milestones

1. Starting-tree snapshot and per-call PostToolUse diff (Tue 29, Wed 30).
2. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
