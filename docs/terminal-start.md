# Try the terminal UI locally

Session runs in VS Code's integrated terminal, Apple Terminal, iTerm2, or
another interactive terminal. Start collects your intent and optional scope,
then leaves the saved confirmation in scrollback.

## Build this checkout

Use Node 20 or newer. From the root of the checkout containing the UI changes,
run these commands in a bash or zsh terminal:

```sh
npm ci
npm run build
SESSION_CLI="$PWD/dist/cli.js"
```

Keep using this terminal tab for the steps below. `SESSION_CLI` points directly
at this checkout's build, even if the globally installed `session` is older.
If Git says the branch is already used by a worktree, open that worktree's
directory and build there.

## Create a disposable demo

This makes a temporary repository and keeps its records in a separate folder.
The Git identity below applies only to this demo repository.

```sh
SESSION_DEMO=$(mktemp -d)
mkdir -p "$SESSION_DEMO/repo/src"
cd "$SESSION_DEMO/repo"
git init -q
git config user.name "Session Demo"
git config user.email "demo@example.test"
printf 'before\n' > src/demo.txt
git add src/demo.txt
git -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -qm "Demo baseline"
```

## Start recording

```sh
SESSION_HOME="$SESSION_DEMO/records" node "$SESSION_CLI" start
```

At **Intent**, type `Test the terminal start flow` and press Enter.
At **Scope (optional)**, type `src/`, press Enter, then press Enter again on
the empty line to finish. Type paths with spaces as they are, without quotes;
each line is one path or folder prefix.

The saved panel shows **RECORDING**, your intent, the declared scope, the
session ID and starting commit. That is when the session has started; the
intent stays fixed. Work in your coding tool as usual after this point.

While answering the prompts, Ctrl-C cancels the draft. Ctrl-D on an empty
input line also cancels it. A cancelled draft creates no session record.
Pressing Enter at the first scope prompt records no declared scope.

For a start with the answers already supplied, use this form instead:

```sh
SESSION_HOME="$SESSION_DEMO/records" node "$SESSION_CLI" start "Test the terminal start flow" --scope src/
```

Choose one start form for each session. A second declared start is refused
while the first is still open.

## Change files, stop and read the record

```sh
printf 'after\n' > src/demo.txt
printf 'outside declared scope\n' > outside.txt
SESSION_HOME="$SESSION_DEMO/records" node "$SESSION_CLI" stop
SESSION_HOME="$SESSION_DEMO/records" node "$SESSION_CLI" week last --full
SESSION_HOME="$SESSION_DEMO/records" node "$SESSION_CLI" verify
```

The demo changes `src/demo.txt` inside the scope and `outside.txt` outside it.
The record names both paths and marks the outside path. With no captured
usage, turns, tokens and cost read `unknown`. `verify` checks the recorded
hash chain and signatures.

To use the same build in your own committed repository, open that repository
in this terminal tab and run `node "$SESSION_CLI" start`. Omitting
`SESSION_HOME` uses your usual record location.

## Terminal behavior

| Situation | What to expect |
|---|---|
| Bare `start` in an interactive terminal | Intent and scope prompts, then the saved panel. |
| Quoted intent in a terminal | The same saved panel, with no prompts. |
| Redirected input or output | Supply a quoted intent. Piped output keeps its compact confirmation. |
| `start --passive` from an editor hook | Silent output. |
| Width between 40 and 80 columns | The saved start panel wraps to fit. |
| Width above 80 columns | The saved start panel stays 80 columns wide. |
| Width below 40 columns | The panel keeps its 40-column minimum; widen the terminal. |
| Width cannot be determined | The confirmation prints without a frame. |

## Color and troubleshooting

The background comes from your terminal. See the [terminal theme
guide](themes/Readme.md) for Apple Terminal, iTerm2 and VS Code.
`NO_COLOR=1` removes Session's styling; `FORCE_COLOR` takes precedence if set.
Use `FORCE_COLOR=0` to force plain text.

If the display still looks like an older version, rebuild this checkout and
use `node "$SESSION_CLI"` throughout the demo. `command -v session` shows
which global executable your shell would otherwise run.
