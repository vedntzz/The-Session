# The Session

**A black box recorder for AI coding sessions.**

When you code with an agent, everything that matters disappears the moment you close the terminal: what you asked for, what it actually touched, how many attempts produced nothing, and whether any of it shipped. So you merge code you can't explain.

`session` records it.

```bash
npm install -g @vedntzz/session
```

```bash
session start "add rate limiting to /orders"
# run Claude Code, Cursor, Copilot — however you normally work
session stop
```

```
$ session show

  add rate limiting to /orders                          14:02 → 14:39

  declared    api/orders.py  api/middleware/
  changed     api/orders.py  api/middleware/rate_limit.py
  outside     db/schema.py                              ← you did not declare this

  3 runs, 2 changed no files                            84,200 tokens
  tests      12 passed
  outcome    open
```

## Why declare intent first

It costs eight seconds and one sentence, and it is the entire point.

Without it there is one entry in the ledger — what the machine produced — and no way to tell whether it was what anyone wanted. With it there are two, and the gap between them becomes visible for the first time. That gap is where nearly every agent bug lives.

## Commands

| | |
|---|---|
| `session start "<intent>"` | Open a session. Records HEAD and your declared scope. |
| `session stop` | Close it. Diffs the repo, reads the agent transcript, writes the record. |
| `session show` | The last session, in full. |
| `session week` | One row per session. Row height is spend. |
| `session week --open` | The same week as an HTML page, in your browser. |

## The record

Five fields. Everything else is a query over them.

- **intent** — what you said you were doing, in your own words. Written once, never editable.
- **scope** — the files you expected to change.
- **reality** — the files that actually changed.
- **cost** — tokens, runs, and how many of those runs changed nothing.
- **outcome** — merged, abandoned, or open.

Stored as JSONL under `~/.session/`. Your data, your disk. No account, no server, no telemetry.

## Agile for AI

Five practices. The tool is the argument for them; you can adopt them without it.

**1. Declare before you generate.** One sentence, before the agent runs. Not a ticket, not a spec — what you are trying to do.

**2. Scope is declared, drift is recorded — not blocked.** Agents wander for good reasons. The failure isn't wandering, it's wandering unnoticed.

**3. Count what produced nothing.** A run that changes no files still costs money. Waste is a first-class number or it is invisible.

**4. The session is the unit of work.** Not the ticket, not the sprint, not the line of code. The session is what you can actually reason about.

**5. The record outlives the session.** Anything not written down at `stop` is gone. Understanding is the artifact; the code is a side effect.

## Status

v0.1. Capture works with Claude Code today. Cursor and Codex adapters are next.

Issues and pull requests welcome — especially from anyone who has tried practice 1 for a week and can tell me whether it holds.

## License

MIT