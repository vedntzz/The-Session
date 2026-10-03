# The Session

**The system of record for agent work.** You declare what an AI coding agent is
about to do; `session` records what it actually changed, how far that went
outside what you declared, whether it landed on the default branch, and what it
cost — signed, append-only, on your own disk.

```
$ session week last

  The work landed on the default branch.
  You asked for "add rate limiting to /orders".
  1 file changed outside what you declared: db/schema.py.

  ace87ecd · $0.45 · 3 turns
```

## Quickstart

From npm install to a recorded session, inside any git repository with Claude
Code installed.

**1. Install.**

```
$ npm i -g @vedantzz/session

added 3 packages in 185ms
```

**2. Register the write check in this repository.** It writes to
`.claude/settings.local.json` only.

```
$ session hook install --repo
  wrote    …/demo/.claude/settings.local.json
  hook     PreToolUse (Edit|Write|MultiEdit|NotebookEdit|Bash) → session hook check
  via      /…/bin/node /…/@vedantzz/session/dist/cli.js
```

Hooks run under `/bin/sh` without your shell's `PATH`, so they name node and
the CLI by absolute path. After you upgrade node or reinstall the package, run
the install again.

**3. Declare what the agent is about to do, and where.** The intent cannot be
edited afterwards.

```
$ session start "add a farewell function next to greet" --scope src
  started  add a farewell function next to greet  (head 8905d07)
  scope    src
```

**4. Run the agent.** Use it the way you normally would.

```
$ claude
```

With Codex, `session hook install` writes the same hooks to `~/.codex/hooks.json` if Codex is installed. Approve them with `/hooks` in the Codex CLI. Until you do, a session's intent is captured only at `session stop`.

**5. Close the record.** It shows what changed, what fell outside the declared
scope, and the cost read from the transcript.

```
$ session stop
  stopped  add a farewell function next to greet
  changed  src/greet.js  test/greet.test.js
  outside  test/greet.test.js
  cost     206,175 tokens  1 turn  (7 api calls)
```

**6. Read it back.**

```
$ session week last

  The work has not landed on the default branch yet.
  You asked for "add a farewell function next to greet".
  1 file changed outside what you declared: test/greet.test.js.

  89720f7a · $0.12 · 1 turn
```

Next: `session hook install` (without `--repo`) registers user-level hooks so
that sessions open and close by themselves. `session scan` shows what agent
sessions already on this disk did, and `session pr` writes a pull request body
from the record.

## Declaring before the agent runs

`session start "<intent>" --scope <paths...>` records your intent and the files
you expect to change. The intent can never be edited afterwards. Without
`start`, the hook records the first prompt as the intent and no scope.

`session prime "<intent>"` previews up to five exact files your past planning
missed; `--start` accepts them, `--scope` replaces them. Its original
suggestion is kept apart from what you accepted. [Prime](docs/prime.md).

Add `--review` to `start` or `prime --start` to accept **terms** as well:
paths, actions (`create`, `edit`, `delete`), sensitive paths, and a policy —
`record`, `ask` or `deny`. Nothing is saved until you type `accept`, and the
terms are signed into the session's first record and cannot change.
[Agreements](docs/agreements.md).

## Checking writes against the terms

`session hook install --repo`, run inside a repository, registers
`session hook check` in that repository's `.claude/settings.local.json` only.
Before each Edit, Write, MultiEdit, NotebookEdit or Bash call, the check answers `ask` or
`deny` when the write falls outside the accepted terms, and says nothing
otherwise. It never grants a permission. `--repo --uninstall` removes it.

- Shell commands are read, not run: npm/pnpm/yarn installs, `sed -i`, `>`,
  `tee`, `mv`, `cp`, `rm` and a short list of read-only commands are
  recognised. Anything else — chains, pipes, scripts, `node -e` — is asked
  about: "Can't tell what this writes." A package manager is recognised only
  at the checkout root, over a `package.json` there: anywhere else it walks up
  to another manifest, and yarn with Plug'n'Play files writes more than its
  lockfile, so both are asked about.
- **When the check itself fails** it denies: a caught error, a malformed
  payload or its own 5-second deadline all answer `deny`, and anything
  unexpected exits 2, which blocks. **When the editor gives up on it** — its
  10-second timeout, a crash, or `session` not on the editor's `PATH` — Claude
  Code lets the write through. Nothing the check does can change that.
- It cannot see what an install script writes — a dependency's, or the
  repository's own `prepare` and `postinstall` — aliases or shell functions,
  or tools other than those five. Under a `record` policy nothing is
  blocked; the diff at `stop` is the record.

## What was recorded

| | |
|---|---|
| `session week` | The last 7 days, one block per intent source. `--md` for Slack or Notion. |
| `session week <id>` | One session: where it landed, what was asked, what drifted. `last` for the latest; `--full` for every path and counter. |
| `session ui` | The same sessions in an interactive terminal browser. |
| `session pr [id]` | A pull request body from the record; pipe into `gh pr create --body-file -`. |
| `session prime --debt` | Files that keep drifting outside the plan, per repo. |
| `session survival` | How much merged work is still there at 14 and 30 days. |
| `session knowledge` | A local graph of which sessions touched which paths, and a JSON export for agents. |
| `session verify` | Check the log's hash chain and signatures. |

Work on files you had already changed before a session started counts too:
the session records a hash of each dirty file at start, and `stop` counts any
whose content the session changed again. `session help all` lists every command.

## Privacy

Records are JSONL under `~/.session/`. No account, no server, no telemetry.
They leave the machine only when you run `session push`, onto a git remote you
already have, on refs of their own. Source code and transcripts are never in
them; the one text you wrote that is, is the intent — or, for a session the
hook opened, your first prompt.

---

[Design decisions](docs/decisions.md) · [Practices](PRACTICES.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE) · [Issues](https://github.com/vedntzz/The-Session/issues)
