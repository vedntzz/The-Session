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
  outside     ! db/schema.py                            ← you did not declare this

  3 turns, 1 without edits                              84,200 tokens
  41 api calls, 30 without edits
  outcome     open
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
| `session week` | One row per session over the last 7 days, and what they came to. |
| `session week --days <n>` | The same, over a window you choose. |
| `session week --open` | The same week as an HTML page, in your browser. |

## The record

Six fields. Everything else is a query over them.

- **intent** — what you said you were doing, in your own words. Written once, never editable.
- **scope** — the files you expected to change. Path prefixes, matched at directory boundaries: `api/middleware/` covers everything beneath it, `api/order` never covers `api/orders.py`.
- **baseline** — what was already modified when the session opened, so you are not billed for work that was sitting there before it.
- **reality** — the files that actually changed, less the baseline.
- **cost** — four token counters, kept apart because cache reads, cache writes, input and output all bill differently; plus how much of the work produced nothing.
- **outcome** — merged, abandoned, or open.

Cost counts two ways, because they answer different questions. **Turns** are your prompts: one per thing you asked for. **API calls** are what each prompt set off — the reads, the greps, the edits. A turn that ends without touching a file is waste you can act on; a call that ends without touching a file is usually just the agent looking something up.

Stored as JSONL under `~/.session/`. Your data, your disk. No account, no server, no telemetry.

## Agile for AI

Five practices. The tool is the argument for them; you can adopt them without it.

**1. Declare before you generate.** One sentence, before the agent runs. Not a ticket, not a spec — what you are trying to do.

**2. Scope is declared, drift is recorded — not blocked.** Agents wander for good reasons. The failure isn't wandering, it's wandering unnoticed.

**3. Count what produced nothing.** A turn that changes no files still costs money. Waste is a first-class number or it is invisible.

**4. The session is the unit of work.** Not the ticket, not the sprint, not the line of code. The session is what you can actually reason about.

**5. The record outlives the session.** Anything not written down at `stop` is gone. Understanding is the artifact; the code is a side effect.

## Status

v0.1. Capture works with Claude Code today. Cursor and Codex adapters are next.

Issues and pull requests welcome — especially from anyone who has tried practice 1 for a week and can tell me whether it holds.

## License

MIT