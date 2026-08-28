# Design decisions

Why `session` is built the way it is. The [Readme](../Readme.md) is the
twenty-second version; this is the rest of it, for anyone deciding whether the
tool's judgement matches theirs.

The invariants these all serve are in [Claude.md](../Claude.md): intent is
immutable, there is no server, nothing calls a model to judge your work, turns
that produced nothing are first-class, and nothing assumes Claude Code.

## Contents

- [The record](#the-record) — the nine fields everything else is a query over, and [one repo, two logs](#one-repo-two-logs)
- [Colour](#colour)
- [What it cost](#what-it-cost) — why money leads, and where the prices come from
- [Did it ship?](#did-it-ship) — outcomes decided on content, not commit shas
- [Did it stick?](#did-it-stick) — survival at 14 and 30 days
- [What will this one cost?](#what-will-this-one-cost) — the class rules and `estimate`
- [The files nobody plans for](#the-files-nobody-plans-for) — `debt`
- [Handing the week to someone else](#handing-the-week-to-someone-else) — `--md`
- [Who the work was for](#who-the-work-was-for) — attribution
- [The log is tamper-evident](#the-log-is-tamper-evident)
- [Sharing them with the team](#sharing-them-with-the-team) — sync over git refs
- [Finding your way around](#finding-your-way-around) — why `--help` is short

---

## The record

Nine fields. Everything else is a query over them.

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

### One repo, two logs

Records are filed per repository, and a repository is identified by its origin remote — or, when it has none, by where it sits on disk. Which means a repo that gains an origin changes name: `path:/home/me/tool` becomes `remote:github.com/acme/tool`, and the next session opens a second log under the new key.

Nothing on disk is moved to fix that. The two logs are two hash chains, signed at different times, and appending to the older one or splicing them into a single file would fork a chain `session verify` is entitled to walk line by line. Writing stays on the current log; the join happens in memory, at read time, where nothing is at stake.

So reading asks the checkout what its origin is now, and reads the log it used to be keyed under as well. `week`, `estimate`, `show` and `settle` all see one history, and a session created before the remote and settled after it — its creating record in one file, its outcome in the other — is folded back into one record rather than losing the half that arrived late.

`session debt` does the same thing without a checkout to start from: it resolves each path-keyed log's own directory to whatever origin it has today, and merges only where some other log is already keyed on that remote. The resolution is the evidence that two logs are one repo; with nothing to merge into, there is nothing to say. A directory that has been deleted, is no longer a repo, or still has no remote gives no answer, and its log stays where it is.

Only that direction resolves. A checkout with a remote can always be asked what it used to be called, because its root is a fact about where it is; a remote-keyed log names no directory to go and ask. And the lookup is never written down: `repo` on a record says what the repository was called when the record was written, which is a fact about the past, and facts about the past are not edited here.

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

## Did it stick?

Merging is not the end of the question. A session merges, the tool records that it landed, and three weeks later the file it wrote holds none of what it wrote — reverted, rewritten by the next person through, or deleted outright. That is the difference between work that shipped and work that stuck, and until now the log had nothing to say about it: `outcome` says the blobs reached the branch once, which is a fact about a moment rather than about what came after.

```
$ session survival

  18 merged sessions · what is still there
  measured against the published benchmark: above 90% of what merged still there, below 10% churned

  14 days   93% of 148 files still there · 18 sessions
            above the 90% benchmark · 7% churn · 8 rewritten, 3 deleted
            6 still inside the window
  class     api   96% of 71 files still there · 9 sessions
            ui    88% of 42 files still there · 6 sessions
  declared  96% of 96 files still there · 11 sessions
  captured  87% of 52 files still there · 7 sessions

  30 days   4 sessions measured — fewer than 5, so no rate · 9 still inside the window
```

**It has to be written down, because it cannot be recomputed.** Every other figure in this tool is a query over the record, and `outcome` is deliberately recomputed on every view because the branch moves. This one cannot be: the tip today says what is there today, and a file rewritten in week three and restored in week six looks untouched to anybody asking afterwards. So the check runs on a schedule and is appended to the log — signed and chained like every other record, per path, with the day it was made and the commit it was made against. `session survival --check` is what runs it, and the report says when one is owed.

A path is **survived** when it still holds the blob the session left, **rewritten** when it holds something else, and **deleted** when it is not there at all. A session that deleted a file survives by the file staying gone; something back at that path is that deletion being undone. A session's survival rate is the share of its paths that survived, and the overall rate is over *paths*, not an average of session rates — a session that touched forty files is forty files' worth of evidence.

Four things it will not do:

**It never counts waiting as failure.** A session merged the day before yesterday has not failed to survive a fortnight. Those are `pending`, on their own line, and they are not in the denominator — otherwise the figure would fall every time you merged something and rise again a fortnight later, and the movement would be the calendar rather than the code.

**It will not answer late.** A window closed more than a week ago is `missed`, not checked: the branch now is not evidence about a fortnight that ended in March, and a late check would quietly report today's tip as though it were that day's. Missed windows are counted and named. This mostly bites on the day you adopt the tool, when a backlog of old merges can never be answered — which is true, and better said than papered over.

**It is dated from when the merge was observed, not when it happened.** Nothing on disk records the latter and nothing can: a squash merge writes a new commit with its own dates and keeps none of the originals. What the log holds is the day somebody looked and found the work there, so a session settled late has late windows. Merged sessions nobody has settled have no date at all, and are counted as `unsettled` with a pointer at `session settle`.

**Declared and captured are never pooled**, and neither is anything below five sessions. Same rules as `estimate`, for the same reasons — a commitment made before the work and a transcript of a prompt are different evidence, and a rate over two sessions looks like knowledge and is not.

The 90% is somebody else's figure, not a measurement this tool made; churn is exactly the share that did not survive, so 90% survival and 10% churn are one line quoted from both ends. It is one constant in `src/survival.ts`, so disagreeing with it is a one-line change.

### Nobody remembers to run it

`session settle` and `session survival --check` both write down answers that stop being available if nobody asks in time. A survival window closes for good a week after it opens. An outcome computed a year late is computed against a branch that has moved. Leaving both to be typed by hand means a log full of questions that were answerable once, which is the failure this whole tool exists to avoid.

So they run themselves, once a day per repository, off the back of whatever you were already doing: the editor hook that closes a session, or the next `week`, `show` or bare `session` you type for some other reason. Both commands still work by hand, unchanged, and `session survival --check` remains the way to force one.

```
$ session week

  recorded 1 outcome, 2 survival checks

  started      intent              cost  turns  empty  outcome
  08-16 03:01  add rate limiting  $4.04     14      3  merged
```

Four rules keep that from being an imposition:

**Silent unless something was written.** A sweep that found nothing to say says nothing at all, which is most days. Printing "nothing to settle" above every week is how a tool teaches people to stop reading its output.

**Once a day, per repo**, stamped in `~/.session/<repo-key>.swept`. The stamp is written *before* the work rather than after, so a sweep cut short — the hook's budget runs out, the terminal closes — waits until tomorrow instead of running again on the very next command. A repo that swept on every invocation because the sweep never finishes would make the whole tool feel broken.

**It cannot fail the command it rode in on.** `session week` exists to print a week, and a repository whose default branch has gone missing is not a reason to refuse to. The sweep is skipped and the command carries on.

**It costs no extra git.** Asking the repository where work went is a `git log` per path, and by far the most expensive thing here — a `week` that swept and then gathered again for its own table would take twice as long on exactly the day you would notice. The sweep gathers once, over every session, and hands the answers to the view that called it.

The `SessionEnd` hook's budget went from ten seconds to thirty to make room, and the stop is written before the sweep begins: a budget that still runs out costs a day of sweeping rather than a record. An installation left at the old ten seconds keeps working, and `session hook install` raises it.

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

## The files nobody plans for

One session drifting onto a file is an accident. The same file, session after session, with nobody ever writing it into a scope, is a fact about the repository rather than about any of those sessions:

```
$ session debt

  remote:github.com/acme/tool
  2 files drifted into 3 or more times and never declared since · 24 sessions of history

  file                sessions drifted  last touched      cost
  src/store.ts                       7    2026-08-21  $184.02
  src/api/orders.ts                  4    2026-08-14   $61.55

  remote:github.com/acme/site
  not enough history to judge — 2 sessions recorded, 3 needed

  cost is the whole of every session that touched the file, so the column does not add up
  docs, config, build files are never listed
```

The whole report is a query over `drift` and `scope`, which are already on the record. Nothing new is measured and no model is asked whether the file is bad code — the claim is only that work keeps landing somewhere nobody plans for, which is a thing the log can prove.

Four rules make it worth reading:

**Three drifts, not one.** Once is an accident, twice is a coincidence. A list that started at one would be a list of everything that ever changed, and nobody would open it twice.

**A later declaration clears it.** The moment somebody runs `session start --scope src/store.ts`, the gap between plan and reality is closed and the file drops off the list — even if it goes on being edited every week. That is the tool working. A list that kept punishing the person who fixed the problem would teach people to stop declaring scopes. Note it is *after*: a file declared in March and drifted onto again in June is owed again, because the plan stopped describing the work.

**Docs, config and build files are never listed.** A lockfile, a workflow and a changelog turn up outside the plan of half the sessions in any repo, because the plan was about the code and these came along with it. They are touched by everything and owned by nobody, and left in they would sit at the top of every repo's list and bury the paths that mean something. The test is the same table `week --class` uses, so a repo whose layout puts the wrong file here is fixed by a line in `classify.ts`.

**Below three sessions, no answer at all.** A repo with two sessions in it has no pattern to have. It gets a sentence saying the history is too short, not an empty list — "we found nothing" and "we could not look" are different statements, and printing the first when the second is true is an all-clear nobody checked.

The report is per repository and never adds up across them. The same path means different things in two codebases, and a file three repos each drifted onto once is not a file three sessions drifted onto. The command reads every log under `~/.session` rather than only the one for the checkout you are standing in, because the pattern takes months to appear and "which repo should I run this in" is the question the report is meant to answer.

The cost column is the only figure here that needs care. It is the whole cost of every session that touched the file, not a share of it — there is no way to divide a session's tokens between the files it changed, and inventing one would put a made-up number beside measured ones. So a session that drifted onto four files appears in four rows, the column does not add up, and the line under the table says so rather than leaving somebody to sum it. A file whose sessions ran on models with no rate reads `—`, never `$0.00`, like every other total in the tool.

## Handing the week to someone else

`session week --md` writes the same window as Markdown, for the places other people read:

```
$ session week --md

### AI-assisted work · 12–18 Aug

**$47.10 spent · 6 changes shipped · 9 files touched outside plan**

| Date | Work | Outcome | Cost | Unplanned |
|---|---|---|---:|---:|
| 12 Aug | add rate limiting to /orders | ✅ | $4.12 | 0 |
| 13 Aug | ~ why does /orders 500 when the cart is empty |  | $0.45 | 0 |
| 15 Aug | migrate the orders table to the new schema | ✅ | $11.90 | 4 |
| **Total** | **9 sessions** | **6 ✅** | **$47.10** | **9** |

2 sessions changed no files and are not in the table, costing $0.61.

~ 1 session recorded by the editor hook: intent captured from the first prompt, no scope declared.

**$7.85 per shipped change.**
```

`--copy` puts it on your clipboard instead of printing it, and implies `--md` — a terminal table is not what anybody pastes into a page. Every `week` filter still applies, so `session week --md --client Acme --days 30` is the month's invoice line.

The tick is the only emoji this tool emits anywhere, and it is here because this output is read in Notion and Slack rather than in a terminal.

Three things it will not do. It will not print a total that quietly omits sessions: when a model has no rate, the cost cell says `unpriced` and a line below says how much of the table the money covers. It will not fold the sessions that changed no files into the figures: they are named below the table with what they cost, so the total row is a total of the rows above it. And it will not print a cost per shipped change when nothing shipped — no dash, no zero, the line is simply absent.

**Nought is not the same as unknown.** When no session in the window has a rate, the money is not reported as `$0.00`:

```
**cost unavailable — no rate for mystery-9 · 1 change shipped · 0 files touched outside plan**
...
| **Total** | **2 sessions** | **1 ✅** | — | **0** |

No cost could be worked out: 2 sessions ran on a model with no rate (mystery-9). Add one to ~/.session/rates.json.
```

A week that genuinely cost nothing still reads `$0.00`, because that is a figure somebody measured — and it reads that way in every view, so a dash never appears over a column of noughts. The rule holds in the other views too: the terminal table puts a dash in its total and leaves the spend line out, the HTML page omits the money from its summary, and `estimate` says so in place of the median. All four ask the same function, so they cannot come to disagree about what a week cost.

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

## Finding your way around

Type `session` on its own and it tells you where you are, not what it can do:

```
$ session

  Recording since 14:02: add rate limiting to /orders.

  session stop   close it and record what changed
  session week   the sessions before this one
```

One sentence, at most two commands. It says something different when nothing is running, and something different again in a repo with no sessions in it yet.

`session --help` is deliberately short — `start`, `week`, and a pointer to the rest:

```
Commands:
  session                   where this repo stands, and what to run next
  start [options] [intent]  Begin a new session
  week [options]            Summarize recent sessions, one row each
  help all                  Every command, not just the ones above
```

Nothing is removed by this. Every command below still runs, and `session help all` lists all of them with their descriptions. The short list is a decision about what a first reader can use, not a claim about what exists — a help screen with fifteen entries is one nobody finishes, and the commands that get lost in it are the ones a newcomer most needs.

---

The five practices these support are in [PRACTICES.md](../PRACTICES.md), and
the full command list is `session help all`.
