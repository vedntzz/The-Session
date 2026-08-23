# The Session

**A black box recorder for AI coding sessions.** You declare what you are about to do; it records what the agent actually changed, what it cost, and whether any of it shipped.

```
$ session show

  You asked for "add rate limiting to /orders".
  1 file changed outside what you declared: db/schema.py.

  $0.42 · 3 turns · 1 produced nothing
```

```bash
npm i -g @vedantzz/session
```

## Quickstart

```bash
session scan           # what the agent sessions already on this disk cost — no setup at all
session hook install   # register the Claude Code hooks, once per machine
# work normally — the hook opens a record and closes it when the agent stops
session                # where this repo stands, and the one thing worth typing next
session week           # one row per session, what each cost, what came of it
```

`scan` is the one command that answers before you have recorded anything: it
reads the transcripts already on your disk, and writes nothing anywhere.

## Why declare intent first

Without a declaration there is one entry in the ledger — what the machine produced — and no way to tell whether it was what anyone wanted. With one there are two, and the gap between them becomes visible. That gap is where nearly every agent bug lives, which is why `intent` is written once at `session start` and can never be edited afterwards.

## Commands

| | |
|---|---|
| `session scan` | What the sessions already on this machine cost, last 30 days. No setup, read-only. |
| `session start "<intent>"` | Open a session by hand. Records HEAD and the scope you declare with `--scope`. |
| `session show` | The last session, in two sentences. `--full` for every path and counter. |
| `session week` | The last 7 days, one row each. `--md` writes it for Slack, Notion or a meeting. |
| `session estimate "<intent>"` | What sessions like this one have cost before, from your own history. |

`session help all` lists the other twelve — `stop`, `settle`, `mark`, `verify`, `push`, `pull`, `peers`, `config`, `key`, `hook`, `intent`, `help`.

## Privacy

Records are JSONL on your own disk under `~/.session/`. No account, no server, no telemetry, and nothing this tool runs is reachable over a network.

They move only over a git remote you already have, only onto refs of their own, and only when you type `session push` or `session pull`.

---

[Design decisions](docs/decisions.md) · [Practices](PRACTICES.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE) · [Issues](https://github.com/vedntzz/The-Session/issues)
