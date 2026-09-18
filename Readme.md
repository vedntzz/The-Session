# The Session

**A black box recorder for AI coding sessions.** You declare what you are about to do; it records what the agent actually changed, how far that went outside what you declared, and whether any of it landed on the default branch.

```
$ session show

  The work landed on the default branch.
  You asked for "add rate limiting to /orders".
  1 file changed outside what you declared: db/schema.py.

  ace87ecd · $0.45 · 3 turns
```

```bash
npm i -g @vedantzz/session
```

## Quickstart

```bash
session scan           # what the agent sessions already on this disk did — no setup at all
session hook install   # register the Claude Code hooks, once per machine
# work normally — the hook opens a record and closes it when the agent stops
session                # where this repo stands, and the one thing worth typing next
session week           # one row per session, where the work went, what drifted
session pr             # the pull request body, from the record — pipe it into gh
```

`scan` is the one command that answers before you have recorded anything: it
reads the transcripts already on your disk and writes no record. Only `--open`
writes at all, and only an HTML page in your temp directory.

## What it is for

Your agent already tells you what a session cost. What nothing tells you is
whether the session did what you set out to do, and whether the result is still
in the repository a week later. `session` records the declaration and the
result side by side, so the week reads:

```
  9 sessions · 4 landed on the default branch · 2 did not · 3 still open
```

and every row underneath it says how far the work went outside what was
declared.

## Why declare intent first

Without a declaration there is one entry in the ledger — what the machine produced — and no way to tell whether it was what anyone wanted. With one there are two, and the gap between them becomes visible. That gap is where nearly every agent bug lives, which is why `intent` is written once at `session start` and can never be edited afterwards.

One session's gap is an anecdote. **Intent debt** is the accumulated gap between what was planned and what was touched, counted per file: the paths work keeps landing in that nobody ever declared. One file drifting once is an accident; the same file, session after session, with nobody ever writing it into a scope, is a fact about the repository rather than about any of those sessions. `session debt` is what lists it.

## Commands

`session ui` opens an interactive terminal ledger for this repository. Use
`--days 30` to look further back. Arrow keys or `j`/`k` select a session in
the timeline; `Enter` expands it inline and `e` reveals usage and evidence.
`/` searches intents, ids and paths, with combinable filters such as
`outside:yes outcome:merged source:declared`. `PgUp`/`PgDn` scroll long entries,
`Esc` clears filters, `r` refreshes, `?` shows help and `q` exits.
The indigo background and periwinkle selection use true colour when the terminal
advertises it (`COLORTERM=truecolor` or `24bit`), with a basic ANSI fallback and
support for `NO_COLOR`. The view reads
local records and current Git outcomes without changing the records.
Use `session week` when piping output to a file.

`session prime "<intent>"` previews up to five specific scope paths, with the
past planning misses supporting each one. `--seed <paths...>` names files to
start from; `--start` accepts this run's proposal and opens an assisted session.
Use `--scope <paths...>` with `--start` to replace the suggestion before it is
recorded. Thin evidence produces no suggestion. [Prime workflow and limits](docs/prime.md).

| | |
|---|---|
| `session scan` | What the sessions already on this machine did, last 30 days. No setup, and no record written. `--open` writes the page instead of printing it. |
| `session start "<intent>"` | Open a session by hand. Records HEAD and the scope you declare with `--scope`. |
| `session show` | The last session: where it landed, what was asked, what drifted. `--full` for every path and counter. |
| `session week` | The last 7 days, one row each: where the work went and what drifted. `--md` writes it for Slack, Notion or a meeting. |
| `session estimate "<intent>"` | What sessions like this one have cost before, from your own history. |
| `session debt` | Files that keep drifting outside the plan and were never declared since, per repo. |
| `session survival` | How much of what merged is still there at 14 and 30 days. `--check` records the checks that are due. |
| `session pr [id]` | A pull request body, written from the record. Pipes into `gh pr create --body-file -`; `--copy`, `--out <path>`, `--template <path>`. |

`session settle` and the due survival checks also run themselves — once a day per repo, off the back of the editor hook or the next `week`, `show` or bare `session` you type. Silent unless something was written, and both commands still work by hand.

`session help all` lists the other twelve — `stop`, `settle`, `mark`, `verify`, `push`, `pull`, `peers`, `config`, `key`, `hook`, `intent`, `help`.

## Knowledge graph and agent context

```bash
session knowledge graph                         # interactive local HTML + compact JSON
session knowledge graph --days 90 --limit 200    # a larger history window
session knowledge graph --no-open --out graph.html
session knowledge context --path src/api --limit 20 > context.json
session knowledge context --session <id>         # JSON only, suitable for an agent
```

The graph opens in your browser and works offline. Search by intent, id or path,
filter outcomes, drag nodes, pan, zoom, and inspect a selected neighborhood.
Circles are sessions; squares are literal paths. Edges distinguish declarations,
observed changes, and changes outside scope. A scope path may be a directory
prefix. Shared paths do not imply dependencies or code quality.

The export keeps original intents and records each path once, referring to it by
index from compact session tuples. A schema and column names travel with the
file, so any agent with file or shell access can decode it without an SDK. Use
`--path` or `--session` to supply relevant context instead of the whole history.
This reduces repeated text; token savings depend on the data and tokenizer.

The signed JSONL log stays authoritative. Graphs are dated snapshots, with
current outcomes resolved when generated. The default is the latest 100 matching
sessions in 30 days; omissions are disclosed. The viewer caps visible nodes for
readability without removing sessions from the JSON export. Empty sessions remain
included, and unknown drift is `null`. No records are modified. See the
[format and limits](docs/knowledge.md).

## Privacy

Records are JSONL on your own disk under `~/.session/`. No account, no server, no telemetry, and nothing this tool runs is reachable over a network.

They move only over a git remote you already have, only onto refs of their own, and only when you type `session push` or `session pull`.

---

[Design decisions](docs/decisions.md) · [Practices](PRACTICES.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE) · [Issues](https://github.com/vedntzz/The-Session/issues)
