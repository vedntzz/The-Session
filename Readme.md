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

  cost        $0.42                                     3 turns, 1 without edits
  no edits    $0.05                                     41 api calls, 30 without edits
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
| `session show --tokens` | The same, with the four token counters spelled out. |
| `session week` | One row per session over the last 7 days, and what they came to. |
| `session week --days <n>` | The same, over a window you choose. |
| `session week --tokens` | Put the token column back beside the money. |
| `session week --client <name>` | Only the sessions recorded for that client. `--project` likewise. |
| `session week --outcome merged` | Only the sessions that ended up there. Also `abandoned`, `open`, `empty`. |
| `session week --class` | Add a column saying what each session was working on. |
| `session week --class ui` | Only the sessions that were. Also `schema`, `api`, `test`, `config`, `docs`, `build`, `other`. |
| `session week --intent declared` | Only the sessions you declared before the agent ran. `--intent captured` for the ones the hook recorded. |
| `session estimate "<intent>"` | What sessions like this one have cost before. |
| `session estimate "<intent>" --scope src/api/` | The same, classified on the paths you expect rather than the words. `--class api` settles it outright. |
| `session week --open` | The same week as an HTML page, in your browser. |
| `session estimate "<intent>" --since 30d` | Only the history since then. Also a date: `--since 2026-05-20`. |
| `session settle` | Write down where every finished session ended up, as a signed observation. |
| `session mark <id> merged` | Say where one went, when the repo cannot know. Also `abandoned`. |
| `session config set client "Acme"` | Record who this repo's work is for. Also `project`, `sow`, `billingCode`. |
| `session config show` | What this repo declares. |
| `session hook install` | Close the session automatically when Claude Code ends one. `--uninstall` removes it. |
| `session verify` | Walk the log's hash chain and check every signature. Exits non-zero if anything was edited. |
| `session verify --log <path> --key <pubkey>` | The same, for a log someone sent you. Reads nothing from `~/.session`. |
| `session verify --peers` | Walk every chain pulled into this repo, key by key. Exits non-zero if any is broken — or if there is nothing to check. |
| `session key show` | Print the public key, for anyone who wants to check your log themselves. |
| `session push` | Publish your records to origin, on a ref of their own. Refuses a log that does not verify. |
| `session pull` | Fetch everyone else's records. Nothing is merged into yours. |
| `session peers` | The keys whose records are on this machine, with counts and dates. |

## The record

Eight fields. Everything else is a query over them.

- **intent** — what you said you were doing, in your own words. Written once, never editable.
- **intentSource** — where those words came from: **declared** if you typed them at `session start`, **captured** if the hook took them off your first prompt. Fixed when the session opens, like the intent itself.
- **scope** — the files you expected to change. Path prefixes, matched at directory boundaries: `api/middleware/` covers everything beneath it, `api/order` never covers `api/orders.py`.
- **baseline** — what was already modified when the session opened, so you are not billed for work that was sitting there before it.
- **reality** — the files that actually changed, less the baseline.
- **cost** — four token counters, kept apart because cache reads, cache writes, input and output all bill differently; plus how much of the work produced nothing, and what those tokens came to in dollars.
- **outcome** — merged, abandoned, open, or empty. Worked out from the repository every time it is shown, not taken on trust from the record.
- **class** — what the session was working on: schema, api, ui, test, config, docs, build, other. Read off the paths it changed, by a table of rules you can edit.
- **attribution** — who the work was for: client, project, sow, billingCode. Optional, and captured at start from the repo rather than typed per session.

Cost counts two ways, because they answer different questions. **Turns** are your prompts: one per thing you asked for. **API calls** are what each prompt set off — the reads, the greps, the edits. A turn that ends without touching a file is waste you can act on; a call that ends without touching a file is usually just the agent looking something up.

Stored as JSONL under `~/.session/`. Your data, your disk. No account, no server, no telemetry.

### Colour

`show` and `week` use colour to say a few specific things and nothing else:
the intent in your terminal's own colour, brightened; drift paths and the
money spent on turns that changed no files in red, and only when that figure
is not zero; declared paths, labels, times and counts dimmed; merged in green;
abandoned dimmed and struck through, never hidden.

Only the 16 basic ANSI colours, so the hues are the ones you chose for your
terminal rather than ones this tool guessed. Colour is always an addition: `!`
still marks every drift path, so nothing is lost to a pipe, a log file or a
screenshot.

Colour goes to a terminal and nowhere else — redirect the output and you get
exactly the bytes above with no escape codes in them. `NO_COLOR=1` turns it
off in a terminal too, and `FORCE_COLOR=1` turns it on anywhere.

## What it cost

Tokens are not a unit anybody budgets in. Money is, so money is what leads.

```
$ session week

  started      intent                         cost  turns  empty  outcome
  08-16 03:01  add rate limiting to /orders  $4.04     14      3  merged
  08-16 11:20  make the retry backoff adap…  $1.02      6      4  abandoned
  08-17 09:05  try the websocket thing       $0.52      3      0  open

  3 sessions                                 $5.58     23      7
  $5.58 spent, $1.54 of it on changes that never merged
  7 of 23 turns changed no files
```

Two figures, because they are two different failures. **Turns that changed no files** is money spent going nowhere inside a session. **Changes that never merged** is money spent on whole sessions that did not land — the abandoned ones, and the ones still in flight, which have not paid for themselves yet either.

The four counters bill at four different rates, so they are priced separately and never summed first: cache reads cost a tenth of fresh input, cache writes a quarter more, and a long session is mostly cache reads. `--tokens` puts the raw counts back, on both `show` and `week`:

```
$ session show --tokens

  cost        $4.04                                     14 turns, 3 without edits
  no edits    $0.54                                     96 api calls, 61 without edits
  tokens      12,000 in · 1,100,000 cache read · 180,000 cache write · 200,000 out
```

`no edits` is the cost of the turns that wrote nothing — **counted at capture, not apportioned**. Which turn every API call belonged to is known while the transcript is being read, so the empty turns' tokens are added up directly. Taking the session total and multiplying by the share of turns that were empty would be a number nobody measured, and it would be wrong in the direction that matters: the expensive empty turn is the one worth seeing.

### Where the prices come from

A `rates.json` ships with the package: dollars per million tokens, per model, per kind of token. Prices change and vendors add models, so it is data rather than code, and you can override or extend it at `~/.session/rates.json`:

```json
{
  "models": {
    "claude-opus-5": { "input": 5, "cacheRead": 0.5, "cacheCreation": 6.25, "output": 25 }
  }
}
```

That file is merged over the bundled one **entry by entry**, so adding one model does not mean copying the whole table and inheriting its staleness. Models are matched exactly or by the longest key that is a prefix at a dash, which is how `claude-sonnet-4-5` prices the dated `claude-sonnet-4-5-20250929` a transcript actually reports.

A model in neither file is not priced at whatever the nearest model costs. It says so:

```
$ session week

  started      intent                        cost  turns  empty  outcome
  08-16 03:01  add rate limiting to /orders     —     14      3  open

  1 session                                     —     14      3
  1 session unpriced: claude-opus-5 — add rates to ~/.session/rates.json
  3 of 14 turns changed no files
```

The tokens are still there under `--tokens`, and the total says how much of itself it could not account for. A guessed rate that ends up on an invoice is worse than an admitted gap.

## Did it ship?

The last question about a session is the one nobody writes down: did any of it survive. `session show` and `session week` answer it by looking, every time they run.

```
$ session week

  started      intent              cost  turns  empty  outcome
  08-16 03:01  add rate limiting  $4.04     14      3  open

# ... the branch is squash-merged and deleted ...

$ session week

  started      intent              cost  turns  empty  outcome
  08-16 03:01  add rate limiting  $4.04     14      3  merged
```

Nothing was written between those two runs. The default branch comes from `origin/HEAD` where the remote states one, then `main`, then `master`.

**It matches on content, not on commits.** A squash merge keeps none of the branch's commits; a rebase rewrites every sha it had. Asking `git branch --contains` would report almost every merged session as abandoned. So `stop` records the blob id of each file the session left, and merged means *those bytes are at that path somewhere in the default branch's history* — which survives squashing, rebasing and cherry-picking alike. Then:

- **merged** — the content reached the default branch.
- **open** — some of it is still sitting in your working tree, unlanded.
- **abandoned** — it is in neither place.
- **empty** — the session changed no files at all.

A session that landed some files and still has the rest in your tree is **open**: the rest has not gone in yet. Once nothing is left in the tree, a partial landing is **merged** — the remainder was dropped in review, which is what review is for.

**Empty is not abandoned.** A session that read the code, answered a question and wrote nothing did not abandon anything, because nothing was attempted. Calling it abandoned puts every one of those sessions into the figures about work that was thrown away — and there are a lot of them. So they are named for what they are and left out of what they are not: the unmerged spend in `week`, and the sample, median, p90, drift and first-time merge rate in `estimate`. Both say how many they left out. What an empty session cost stays in the total, because it was spent.

It is read off what the session changed, so it needs no repository to decide and nothing later can revise it. `session mark` refuses these: where no work was done, there is nothing a person can know better about — and if it did change files, it is the record of what it changed that is wrong, which a mark cannot fix.

### Writing the answer down

A live computation is right for a screen and wrong for a dataset: it depends on a branch that moves, and the same question next year gets a different answer with nothing to say that it changed. So `session settle` records it.

```
$ session settle

  branch   main
  ac34615a merged              1 file in the branch
  487aa3ad abandoned           1 file nowhere
  settled  2 sessions recorded
```

Each is appended to the log as a signed observation carrying the outcome, when it was observed, and the commit the default branch was at — inside the same hash chain as everything else, so a settled answer cannot be quietly revised. Re-running changes nothing while nothing has changed; a session that has since moved gets a *second* observation rather than an edited first one, so the log shows it moved and when.

### When the repo cannot know

Work ships as somebody else's patch. A file gets renamed. A branch merges somewhere this tool was never told about. So:

```bash
session mark 487aa3ad merged
```

That is written as a manual observation, and it wins — over the computation, and over any later `settle`. A person can see things the algorithm cannot.

## What will this one cost?

Every session is filed under what it was working on — `schema`, `api`, `ui`, `test`, `config`, `docs`, `build`, `other` — from the paths it changed. The rules are a table of path patterns at the top of `src/classify.ts`, in order, first match wins. No model is asked; if your repo is laid out differently, the fix is a line in that table.

```
$ session week --class

  started      intent                class   cost  turns  empty  outcome
  08-16 03:01  rate limit /orders    api    $6.19     14      3  merged
  08-16 09:40  restyle the header    ui     $1.55      4      4  open
```

Which makes the question you actually have before starting answerable from your own history:

```
$ session estimate "rate limit the /orders endpoint"

  estimate  rate limit the /orders endpoint
  class     api         from the intent

  declared  9 sessions  intent written at session start
  median    $7.43
  p90       $14.85
  merged    6 of 8 first time (75%), 1 still open
  drift     src/store.ts  5 of 9
            rates.json    2 of 9
  unpriced  1 session ran on a model with no rate; the money above is the other 8

  captured  6 sessions  intent taken from the first prompt
  median    $2.25
  p90       $9.00
  merged    1 of 5 first time (20%), 1 still open
  drift     nothing was declared to drift from, so none is counted
```

**Two blocks, never a total.** A session you declared is a commitment you made before the agent ran; one the hook caught is a transcript of a prompt. They are not the same kind of evidence, and on most logs they do not cost the same or land at the same rate — look at the two medians and the two merge rates above. Pooled, those fifteen sessions would report one median somewhere in the gap, describing neither side, and it would move whenever the mix moved with nothing on the page to say that was what changed. Teams that adopt the hook record far more captured sessions than declared ones, so the pooled figure drifts towards whatever the hook happened to catch.

The five-session floor applies to each block on its own, for the same reason: six declared and six captured sessions are not twelve of anything. A block with nothing in it still prints, so the other one is never mistaken for the whole answer.

*First time* is the first time anyone looked: the first observation `settle` wrote, or the answer computed now for a session nobody has settled yet. A session that was abandoned, picked up again and landed a month later merged — but it did not merge the first time, and a rate that pretended otherwise would flatter every class in the table.

The class is read off the words unless you say better: `--scope src/api/` classifies on the paths you expect, which is the more reliable signal, and `--class api` settles it outright. Narrow the history with `--since 30d` or `--since 2026-05-20`.

Nothing here is a projection. It is sessions that already ran, restated — which is why a block with fewer than five of them prints the count and no figures at all:

```
$ session estimate "restyle the header component"

  estimate  restyle the header component
  class     ui          from the intent

  declared  3 sessions  intent written at session start
  too few   nothing is estimated from fewer than 5 sessions

  captured  none — the hook recorded nothing like this

            widen --since, or say --class if these were the wrong ones
```

A median of two is a number that looks like knowledge. The drift column is the part worth reading twice: those are the files your api sessions keep wandering into, and they are the ones to put in `--scope` this time.

## Who the work was for

If you bill this work to someone, say so once, in the repo:

```bash
session config set client "Acme"
session config set project "orders-api"
session config set sow "SOW-2026-014"
session config set billingCode "ACME-ORD-1"
```

That writes `.session.json` at the repo root. **Check it in.** It is the one thing `session` reads that belongs to the repo rather than to you: everyone on the team then records the same client under the same spelling, which is the whole point. Your own settings stay under `~/.session`, where machine-specific things belong. All four fields are optional, and a repo that declares none behaves exactly as before.

Every `session start` copies what the file says into the record — a copy, not a reference. Change the client today and last quarter's sessions still say who last quarter was billed to. For the same reason attribution cannot be patched afterwards, any more than intent can, and it sits inside the signed record, so rebilling a session after the fact breaks the chain.

Then the week can be narrowed to one of them:

```
$ session week --client Acme

  only client Acme
  started      intent                         cost  turns  empty  outcome
  08-16 02:41  add rate limiting to /orders  $4.04     14      3  merged

  1 session                                  $4.04     14      3
  $4.04 spent, $0.00 of it on changes that never merged
  3 of 14 turns changed no files
```

Matching ignores case and surrounding space — the value was typed into a shared file by one person and typed again on the command line by another. It is exact otherwise: a prefix match would fold Acme and Acme Corporation into one invoice.

## The log is tamper-evident

A record you can quietly edit afterwards is not a record. So each line carries the hash of the line before it, its own hash, the fingerprint of the key that signed it, and an Ed25519 signature over that hash. Edit a line and its hash stops matching; delete or reorder one and every line after it stops matching. Forge one and you need the key.

```
$ session verify

  log     41 records  /Users/you/.session/1f6c497ab2eb1fd5.jsonl
  key     ed25519:af1c0907bd6402462cbe736232d0ac7a, as the log claims
  chain   intact — 41 records, hashes and signatures check out
```

Edit one line of that file and the same command says so, and exits non-zero:

```
$ session verify

  log     41 records  /Users/you/.session/1f6c497ab2eb1fd5.jsonl
  key     ed25519:af1c0907bd6402462cbe736232d0ac7a, as the log claims
  broken  line 12 does not match the hash it carries — its contents were edited
  record  6a8c1c0f  2026-08-15T14:39:11.204Z
  chain   11 records verified before the break
```

A log with nothing in it is not a pass either:

```
$ session verify

  log     0 records  /Users/you/.session/1f6c497ab2eb1fd5.jsonl
  chain   no records — nothing was verified. Run session start to record one.
```

That exits non-zero too. Nothing about an empty log contradicts itself, so a chain walk over it finds no fault — but it establishes nothing, and a tool whose whole job is evidence must not answer "verified" to a file it read nothing out of. The exit code is worth having only if a zero means somebody checked something.

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
  chain   intact — 41 records, hashes check out
```

Note what that last line does not say. Without a key the hashes are checked and the signatures are not, and it reports exactly the half it did.

That fingerprint is inside each record's hash, so it cannot be swapped out without breaking the record. Two things follow. If you were told a fingerprint in advance, you can see whether you were handed a log signed by something else. And a key that changes partway through a log — the mark of records appended from somewhere else — is caught even by a reader holding no key at all.

### What it does not do

The fingerprint is a claim, not a proof. Someone who rewrites a log wholesale with their own key produces one that is internally consistent and claims their key throughout; only a fingerprint you learned independently tells you it is the wrong log. Nor can anything here catch a log with the tail cut off, or one whose signing key was sitting on the machine that did the editing. No single file on one disk can, and pretending otherwise would be worse than saying so.

## Sharing them with the team

Records are a signed, hash-chained file. What they lack is a way to reach anyone else — and the one piece of shared infrastructure a team already has, already authenticates against and already backs up is a git remote. So that is where they go, on refs of their own:

```
$ session push

  verified 4 records, chain intact
  ref      refs/session/ed25519-32e30104f89848db2616e740fe3a58d9
  pushed   4 records to origin
```

```
$ session pull

  ed25519:32e30104f89848db2616e740fe3a58d9  4 records  unchanged
  ed25519:6f17d3892712d684ff91e0dcfdaef135  2 records  new
  pulled   2 keys from origin
```

```
$ session peers

  ed25519:32e30104f89848db2616e740fe3a58d9  4 records  last 2026-08-18  (this machine)
  ed25519:6f17d3892712d684ff91e0dcfdaef135  2 records  last 2026-08-18
  peers    2 keys on this machine
```

### Checking what the team published

`session verify` walks one log — yours. Once a `pull` has brought other people's chains into the repo, it says so rather than letting a clean bill of health on one log read as a clean bill of health on everything sitting here:

```
  chain   intact — 41 records, hashes and signatures check out
  peers   1 other chain in this repo went unchecked — session verify --peers walks it
```

`--peers` walks every one of them, and reports each key separately:

```
$ session verify --peers

  ed25519:32e30104f89848db2616e740fe3a58d9  intact — 4 records, hashes and signatures check out  (this machine)
  ed25519:6f17d3892712d684ff91e0dcfdaef135  intact — 2 records, hashes check out
  chains  2 keys, every chain checked
```

Separately, not summed: each chain is one key's statement about its own work, and "4 of 5 keys check out" is not a fact about anything. A break in one of them says nothing about the others, and the command exits non-zero on any of them — or on finding no chains at all.

Note the second row. Your own signatures are checked, because your key is here; a peer's are not, because theirs is not, and the row says which happened rather than blurring the two. Hand `--peers` their public key and their signatures get checked too. A key is only ever used on the chain that claims it: checking one key's signatures against another key's log would report a mismatch that says nothing about either.

`(this machine)` means the key in `~/.session/keys` on this machine signed that chain, and nothing else. Not a ref that looks like yours, and not records that read like yours — a ref name is a claim by whoever pushed it. On a machine that has never signed anything, no chain is labelled, which is the truth: nothing there could have written one.

**One ref per signing key.** `refs/session/<fingerprint>` is written only by the machine holding that key. Two developers never write the same ref, so there is nothing to merge and no conflict to resolve — not resolved, made impossible.

**Pull does not merge.** It fetches everyone's refs and stops there. A chain is one key's statement about its own work; folding two of them together would produce a file neither key could stand behind. Other people's records sit beside yours, read-only, and this machine keeps appending to exactly one log — its own.

**Push refuses a log that does not verify.** The chain is walked before anything leaves the machine, and a break stops the push with the line number on it. Publishing a record you cannot stand behind is worse than publishing nothing.

**Your git is untouched.** Nothing lands under `refs/heads`, `refs/remotes` or `refs/tags`, so `git log`, `git status` and `git branch -a` look exactly as they did. (`git log --all` does show them — it means *every* ref, and shows `refs/notes` and `refs/stash` the same way.) The records themselves are ordinary git objects, so anyone with the repo can read one without this tool:

```
$ git log --oneline refs/session/ed25519-32e30104f89848db2616e740fe3a58d9

  4aec7d4 session log — 4 records
  d8dd1f1 session log — 2 records

$ git cat-file -p refs/session/ed25519-32e30104f89848db2616e740fe3a58d9:session.jsonl
```

That history is the point of committing rather than dropping a blob: what was published and when is itself a record, and a rewrite shows up as a tip that no longer descends from the old one instead of quietly replacing it.

No server, no account, no database — the same as before. Records move by git talking to git, only when you type `push` or `pull`.

## Agile for AI

Five practices, written up in **[PRACTICES.md](PRACTICES.md)**: declare before you generate, record drift rather than blocking it, count what produced nothing, treat the session as the unit of work, and keep a record that outlives it. The tool is the argument for them; you can adopt them without it.

## Status

v0.2. Capture works with Claude Code today; Cursor and Codex adapters are next.

New in this release: **dollars** everywhere tokens used to be, with prices as data you can correct; **outcome detection** that decides merged on content rather than commit shas, and `settle` to write the answer down; a **tamper-evident log** you can hand someone with `session verify --log … --key …`; and **`session estimate`**, which answers "what will this cost" from the sessions you already recorded.

Issues and pull requests welcome — especially from anyone who has tried practice 1 for a week and can tell me whether it holds.

## License

MIT