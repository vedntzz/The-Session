# Parking lot

Ideas that came up during a sprint. They go here, never into the sprint; each
is picked up only by a later plan. Newest first. Record where each came from.

## From Sprint 2

- **Which shell runs a Bash tool command.** `simpleWords` models POSIX sh.
  If Claude Code runs commands in the user's login shell (zsh on macOS), zsh
  expansions such as `=cmd` at the start of a word (a command's full path)
  would change an operand without the tokenizer seeing it. Verify before the
  shell check is wired, and refuse a leading `=` if so. (Read-only step.)
- **`~` inside a word.** The tokenizer refuses `~` anywhere, so `git diff
  HEAD~1` is unknown; a shell expands `~` only at a word's start. Narrowing
  that is a tokenizer change shared by every shell parser. (Read-only step.)

## From Sprint 1

- **Warn at `hook install --enforce` when `session` is not on `PATH`.** A
  command the editor cannot start lets every write through, and nothing inside
  the check can close that. The installer's `PATH` is not necessarily the
  editor's, so a warning, not a refusal. (Failure-behaviour step.)
- **Faster check start.** About 75 ms of each 190 ms check is loading the whole
  CLI; a lazy import for `hook check` would cut it. Not needed at 4% of the
  deadline. (End-to-end latency step.)
- **`.claude/settings.local.json` in `.gitignore`.** `--enforce` creates the
  file but does not ignore it; Claude Code usually does, a bare repo will not.
  (Enforce install step.)
- **Show whether the check is installed** on the review screen and start line,
  instead of the static "checked where `--enforce` has run". Would need to read
  every settings layer Claude Code merges. (Enforce install step.)
- **Bind an agreement to an editor session, not just a checkout path.** Two
  editors in one checkout share one agreement today. (Checkout-binding step.)
- **External proposals.** The record already carries `proposer: "external"`;
  ingesting one needs its own input and review design so it is never shown as
  Prime's. (Agreement record step.)
