# Sprint handoff

Updated: 23 September 2026. One small feature, tests, handoff, then stop for
Vedant's review and commit. Never stage, commit or push automatically.

## Current milestone: Sprint 2, Sun 27 — sed in-place recognition

Complete and tested; waiting for Vedant's review and commit.
Previous package-manager milestone committed at `d4d0133`; archived in
[14-package-manager-recognition.md](14-package-manager-recognition.md).
The working tree was clean at the start.

### Solved

- `src/shell/sed.ts`: pure `sedWrites(command, dialect?)`, returning writes
  with persistent operand/backup paths, or unknown. Never executes commands.
- Explicit GNU/macOS dialect required. Missing/unknown dialect is unknown;
  the host OS is not evidence of which sed an editor's PATH runs.
- Simple slash-delimited substitutions, separate -e expressions, -n/-E,
  GNU -i/--in-place and macOS -i with a required extension (including empty).
- Simple backup suffixes include each backup alongside its operand; duplicate
  paths removed. Paths are not canonicalized or checked against scope here.
- Unknown flags, script files, shell expansions/chains/redirects, sed execution
  or extra-write commands/flags, addresses, escapes, bracket expressions and
  complex backup templates remain unknown.
- Reuses simpleWords unchanged. Does not change existing package-manager
  parsing, CLI output, hook matchers, settings or records.
- Agreements-and-enforcement skill guided positive recognition and explicit
  uncertainty. GNU/BSD sources and limitations linked in docs/agreements.md.

### Tests and failures

- 45 new sed tests passed; 58 existing package-manager/tokenizer tests passed.
- Build and source/test type checks passed.
- 8 generated-context tests passed (111 targeted tests total); final diff check passed.
- No implementation/test failures. No full-suite rerun for this isolated,
  unwired pure parser; earlier full-suite counts are historical.

### Limits

This recognizes a deliberately small subset, not arbitrary sed programs.
It lists persistent targets/backups, not temporary files. Actual executable
identity, path/symlink resolution, action classification and Bash integration
remain later work. No shell interception or successful write is claimed.

## Remaining work — each a separate reviewed milestone

1. Rest of Sun 27: redirects (>), tee, mv, cp, rm, and a read-only allowlist.
2. Mon 28: wire shell recognition into check; unknown non-read-only commands
   ask "Can't tell what this writes." Never grant broad approval.
3. Codex days: starting-tree snapshot, then per-call PostToolUse diff.

Still owed from Sprint 1: retrospective, three-screen prototype and the
interactive two-minute ask check. Sprint 1 review: docs/sprint-1-review.md.

Changes are uncommitted. No staging, commit, push, PR, user-settings change,
dependency installation or worktree cleanup. Codex stops for Vedant.
