# Parking lot

Ideas that came up during a sprint. They go here, never into the sprint; each
is picked up only by a later plan. Newest first. Record where each came from.

## From Sprint 2

- **Aliases, functions and `PATH`.** A name on the read-only list runs
  whatever the shell resolves it to: an alias or function from the user's rc
  file, or an earlier executable on `PATH`. The command text cannot show
  that. Options: run the check's own `command -v` in the editor's shell, or
  accept it as a stated limit. (zsh tokenizer step.)
- **`~` inside a word.** The tokenizer refuses `~` anywhere, so `git diff
  HEAD~1` is unknown; a shell expands `~` only at a word's start. Narrowing
  that is a tokenizer change shared by every shell parser. (Read-only step.)

## From Sprint 1

- **Warn at `hook install --repo` when `session` is not on `PATH`.** A
  command the editor cannot start lets every write through, and nothing inside
  the check can close that. The installer's `PATH` is not necessarily the
  editor's, so a warning, not a refusal. (Failure-behaviour step.)
- **Faster check start.** About 75 ms of each 190 ms check is loading the whole
  CLI; a lazy import for `hook check` would cut it. Not needed at 4% of the
  deadline. (End-to-end latency step.)
- **`.claude/settings.local.json` in `.gitignore`.** `--repo` creates the
  file but does not ignore it; Claude Code usually does, a bare repo will not.
  (Enforce install step.)
- **Show whether the check is installed** on the review screen and start line,
  instead of the static "checked where `--repo` has run". Would need to read
  every settings layer Claude Code merges. (Enforce install step.)
- **Bind an agreement to an editor session, not just a checkout path.** Two
  editors in one checkout share one agreement today. (Checkout-binding step.)
- **External proposals.** The record already carries `proposer: "external"`;
  ingesting one needs its own input and review design so it is never shown as
  Prime's. (Agreement record step.)
