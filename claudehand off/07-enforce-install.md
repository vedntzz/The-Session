# Sprint handoff

Updated: 22 September 2026. Implement one milestone, test, stop for Vedant
to review/commit/push. Never stage or commit automatically.

## Current milestone: opt-in, per-repository enforcement install

Complete and tested; waiting for Vedant's review and commit.

### Previously completed

- `d7346f4`: [agreement record](01-agreement-record.md).
- `0b9ffda`: [review screen](02-agreement-review.md).
- `36d7f13`: [decision logic](03-agreement-decisions.md).
- `da8c993`: [parser/resolver](04-write-parser-resolution.md).
- `ff917f7`: [check command](05-write-check-command.md).
- `5f51900`: [checkout binding](06-checkout-binding.md).

Uncommitted alongside this milestone: a refresh of `Claude.md`, `AGENTS.md`,
the skills and `docs/context.md` for the agreement work (new skill
`agreements-and-enforcement`, invariant 6, record fields, layout).

### Solved

- `CHECK_HOOK` in `src/capture/hook.ts`: `PreToolUse`, matcher
  `Edit|Write|MultiEdit`, command `session hook check`, timeout 10 s. Kept out
  of `HOOKS`, so the user-level install/uninstall never adds or removes it.
- Matcher-aware settings surgery: an entry under a different matcher reads as
  not registered and is moved (other entries in that group are kept); a stale
  timeout is repaired in place; repeat installs register once. `withHook` and
  `withoutHook` are pure and do not mutate their input.
- `session hook install --enforce` writes only `<root>/.claude/settings.local.json`,
  found from any subdirectory. Creates the file if absent; keeps other settings,
  other hooks and the file mode; unchanged file keeps its mtime. Invalid JSON
  is refused and left as it was. Outside a repository it refuses and writes
  nothing. `--uninstall` and `--passive`/`--no-passive` with `--enforce` are
  refused by name.
- Wording: review screen now says policy is checked only where
  `--enforce` has run, only for Edit/Write/MultiEdit, never shell commands.
  Start line says `(never blocks)` for record, `(checked where session hook
  install --enforce has run)` for ask/deny. README, CHANGELOG,
  `docs/agreements.md`, both skill copies updated.

### Verification and failures

- Build and source/test type checks passed.
- Full suite: **1,637 tests passed across 51 files** (1,615 before, +22).
  New: 9 check-hook settings tests, 11 install tests (3 of them refusal
  cases), 1 matcher format test, 1 start-line test; review wording test updated.
- Built-CLI smoke in a temporary repo and HOME: install from `src/`, repeat
  install says `already`, existing `permissions` kept, user settings byte-
  identical, three refusals exit 1, `--help` lists `--enforce`, and the
  installed command denies an out-of-scope write under a deny agreement.
- Failures: the first doc-edit script stopped on one mis-wrapped sentence in
  `docs/agreements.md` (fixed, re-applied); the first smoke script failed on
  zsh word-splitting (script bug, rerun with a function). No code failures.

### Boundaries

Not exercised in a running editor. The check still denies unparseable input
and a missing repository, which is why it is per-repository. Claude Code's
behaviour when the handler times out or crashes is host behaviour, not
verified here. `.claude/settings.local.json` is not added to `.gitignore` by
this command; Claude Code normally ignores it, but a repo that does not will
show it as untracked.

## Next milestones — stop and commit after each

1. `--enforce --uninstall`: remove only `CHECK_HOOK` from the repo file,
   prune what it emptied, leave the user-level hooks alone.
2. Timeout/failure behaviour: tests and clear host-guarantee documentation.
3. End-to-end editor flow, latency checks, sprint review and retrospective.

Other outstanding sprint items remain unverified: three-screen prototype,
Claude resize/changelog work in `/Users/vedant/dev-session-ui`, hook research
`2a06865` in `/Users/vedant/dev-session-hook`, and external-proposal ingestion
scope. No overall completion percentage.
