# The Session

**A black box recorder for AI coding sessions.**

When you code with an agent, everything that matters disappears the moment you close the terminal: what you asked for, what it actually touched, how many attempts produced nothing, and whether any of it shipped. So you merge code you can't explain.

`session` records it.

```bash
npm install -g @vedantzz/session
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
| `session hook install` | Close the session automatically when Claude Code ends one. `--uninstall` removes it. |
| `session verify` | Walk the log's hash chain and check every signature. Exits non-zero if anything was edited. |
| `session verify --log <path> --key <pubkey>` | The same, for a log someone sent you. Reads nothing from `~/.session`. |
| `session key show` | Print the public key, for anyone who wants to check your log themselves. |

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

## The log is tamper-evident

A record you can quietly edit afterwards is not a record. So each line carries the hash of the line before it, its own hash, the fingerprint of the key that signed it, and an Ed25519 signature over that hash. Edit a line and its hash stops matching; delete or reorder one and every line after it stops matching. Forge one and you need the key.

```
$ session verify

  log     41 records  /Users/you/.session/1f6c497ab2eb1fd5.jsonl
  key     ed25519:af1c0907bd6402462cbe736232d0ac7a
  chain   intact — 41 records, hashes and signatures check out
```

```
$ session verify

  broken  line 12 does not match the hash it carries — its contents were edited
  record  6a8c1c0f  2026-08-15T14:39:11.204Z
  chain   11 records verified before the break
```

The keypair is generated on this machine the first time you record anything, and lives at `~/.session/keys/` with the private half at mode 0600. It is never transmitted — there is nowhere to transmit it to. `session key show` prints the public half.

### Checking a log you were sent

Send someone the log file and your public key, and they can check it on a machine that has never run `session start`:

```
$ session verify --log theirs.jsonl --key theirs.pub

  log     41 records  theirs.jsonl
  key     ed25519:af1c0907bd6402462cbe736232d0ac7a from theirs.pub, as the log claims
  chain   intact — 41 records, hashes and signatures check out
```

Nothing under `~/.session` is opened, or created, along the way. With `--log` and no `--key`, the hashes are still checked and the log tells you which key it wants:

```
  key     not checked. Pass --key to check the signatures.
  claims  ed25519:af1c0907bd6402462cbe736232d0ac7a signed it — the key to ask for
```

That fingerprint is inside each record's hash, so it cannot be swapped out without breaking the record. Two things follow. If you were told a fingerprint in advance, you can see whether you were handed a log signed by something else. And a key that changes partway through a log — the mark of records appended from somewhere else — is caught even by a reader holding no key at all.

### What it does not do

The fingerprint is a claim, not a proof. Someone who rewrites a log wholesale with their own key produces one that is internally consistent and claims their key throughout; only a fingerprint you learned independently tells you it is the wrong log. Nor can anything here catch a log with the tail cut off, or one whose signing key was sitting on the machine that did the editing. No single file on one disk can, and pretending otherwise would be worse than saying so.

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