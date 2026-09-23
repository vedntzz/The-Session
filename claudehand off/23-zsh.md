# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2 — the tokenizer holds against zsh

Complete and tested; waiting for review and commit. The allowlist was
committed as `4917d28`; its handoff is archived in [22-read-only.md](22-read-only.md).

### Verified

Claude Code's Bash tool runs `/bin/zsh` 5.9 here (`ps -p $$`, `ZSH_VERSION`,
23 September 2026, macOS); the earlier "(eval): no matches found" errors in
this project's sessions were zsh's too. `simpleWords` modelled POSIX sh only.

### Solved

- `src/shell/words.ts` now also refuses an unquoted `^` (zsh glob operator
  under `extendedglob`, which a user's rc may set) and an unquoted `=` at the
  start of a word (zsh expands `=cmd` to its path, so `rm =node` would have
  parsed as a file named `=node`). Quoted, both stay literal; a mid-word `=`
  (`--registry=x`, `a=b`) is unchanged. Cost: `git diff HEAD^` becomes unknown.
- Stated, not solved: aliases, shell functions and `PATH` can change what a
  listed name runs, and the command text cannot show it. Written into
  `docs/agreements.md`; parking-lot entry replaces the "which shell" question.
- Skill rule updated (both copies): model the strictest shell the editor may
  use. `docs/context.md` regenerated.

### Checks

- 2 new tokenizer tests (refusals, and quoted/mid-word forms kept). All 9
  shell suites (473 tests) passed after the change.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,115 passed across 59 files**, plus
  8 context tests (2,123 total; 2,121 before).

## Remaining Sprint 2 work — separate milestones

1. Shell-check integration (Mon 28): unknown non-read-only commands ask
   "Can't tell what this writes." Grants scoped to one operation.
2. Starting-tree snapshot and per-call PostToolUse diff (Tue 29, Wed 30).
3. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
