# Sprint handoff

Updated: 23 September 2026. One bounded milestone, tests, handoff, then stop
for Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2 — the read-only allowlist

Complete and tested; waiting for review and commit. The rm step was committed
as `daa2e65`; its handoff is archived in [21-remove.md](21-remove.md). This
closes Sunday 27's items: every parseable writer plus the allowlist.

### Solved

- `src/shell/read-only.ts`: pure `readOnlyWrites(command)` → `writes []` or
  `unknown`, the same `ShellWrites` shape the package-manager step returns.
- Listed with any arguments (no option writes, runs a program or names an
  output): cat, head, tail, wc, ls, pwd, echo, true, false, grep, egrep, fgrep,
  diff, cmp, stat, du, df, which, basename, dirname, realpath, readlink,
  whoami, uname.
- Listed with conditions: `find` without -delete, -exec, -execdir, -ok,
  -okdir, -fprint, -fprint0, -fprintf, -fls. `git` status, log, diff, show,
  blame, ls-files, rev-parse, describe, shortlog; branch and remote only in
  listing forms; no global option before the subcommand; `--output` and
  `--ext-diff` anywhere make it unknown.
- Deliberately unlisted: sort, uniq, tree, file, rg, env, xargs, date.
- Found while testing: the shared tokenizer refuses `~` anywhere, so
  `git diff HEAD~1` is unknown. Left as is (widening the tokenizer affects every
  shell parser); pinned by a test and parked.
- Parked for before wiring: whether the Bash tool runs commands in zsh, whose
  `=cmd` expansion `simpleWords` would not see.
- Docs: allowlist section in `docs/agreements.md`, a skill rule ("the read-only
  list is a grant in waiting", both copies), layout line, two parking-lot
  entries, `docs/context.md` regenerated.

### Checks

- 73 new tests (`test/read-only.test.ts`). First run: 1 failure, the `HEAD~1`
  case above; the case was moved to the unknown list with its reason.
- Build and source/test type checks passed.
- Full suite via the context generator: **2,113 passed across 59 files**, plus
  8 context tests (2,121 total; 2,048 before).

## Remaining Sprint 2 work — separate milestones

1. Verify which shell the Bash tool uses (parking lot), then shell-check
   integration (Mon 28): unknown non-read-only commands ask
   "Can't tell what this writes." Grants scoped to one operation.
2. Starting-tree snapshot and per-call PostToolUse diff (Tue 29, Wed 30).
3. The npm install / sed / node -e walkthrough (Thu 1); fixes and retro (Fri 2).

Sprint 1 still owed (Vedant): retrospective, three-screen prototype,
interactive two-minute ask check.
