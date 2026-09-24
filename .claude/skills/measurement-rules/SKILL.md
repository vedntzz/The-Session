---
name: measurement-rules
description: Load when changing how a session's outcome, class, intent source or cost is decided or displayed — editing outcome.ts, classify.ts, stop.ts's reality, observe.ts, pricing.ts, scan.ts, rates.json, or debt.ts; changing Prime's proposal rule or evaluation; adding a class rule or a model price; touching a view that prints money, a median, a merge rate, a drift figure, or any total that might have nothing behind it. Also load before "simplifying" a figure, apportioning one counter from another, or making an unpriced total read as zero.
---

# Measurement rules

What the tool is allowed to claim it measured, and how each figure is arrived
at. The rationale, with worked examples, is in
[docs/decisions.md](../../../docs/decisions.md) — this file is the rules a
change has to hold to.

Everything here sits inside **invariant 3**: git plumbing, hashes, regular
expressions over path strings, and multiplication by a number in a file. No
model is ever asked whether work shipped, what code is, or whether money was
well spent.

## Outcome

Rationale and examples: [Did it ship?](../../../docs/decisions.md#did-it-ship).

`outcome` on a stored record is not what any view shows. `week` and `week <id>` run
`withOutcomes`, which replaces the field in memory with what the repository says
right now; the field on disk is only ever what `settle` or `mark` last wrote,
for the benefit of whoever reads the raw JSONL. Don't "simplify" this by reading
the stored field — a session merges long after it stopped, and nothing tells
the tool when.

Merged is decided on **content**, never on commit shas. A squash merge keeps
none of the branch's commits and a rebase rewrites all of them, so
`branch --contains` reports nearly every merged session as abandoned. The test
is whether the blob the session left is at that path anywhere in the default
branch's history. That is what `endState` is for.

A manual `mark` outranks the computation permanently — it can see renames,
reverts and other repos, and the computation cannot. A `computed` observation
never outranks a fresh computation.

The one thing a mark does not outrank is `empty`. A session whose `reality` is
empty changed no files, so nothing was attempted and nothing was abandoned —
and everything a person knows better than the computation is knowledge about
where work went, which is not a question a session without any work has. So
`empty` is decided first, from the record alone, before facts or marks are
looked at; `mark` refuses these rather than writing an observation the display
would then ignore, and refuses `empty` as a mark since nothing declares it.
`settle` skips them too: `empty` is read off `reality` every time it is asked,
so an observation saying so would be a copy of a field that cannot disagree
with it.

Empty sessions are excluded from every figure about work: the unmerged spend
in `week` (they had no change to land — the money is still in the total). They
are counted and named there rather than dropped quietly. What they are
not excluded from is what they cost: that was spent.

Note an empty session is not the same as one that touched files and left no
end state for any of them — that one attempted something, and `classify`
reports it abandoned. `attemptedNothing` is the whole test, and it is false
while a session is still running: a session that has changed nothing *yet* is
`open`.

## Reality and the starting snapshot

`reality` is what the session changed: the diff against `startCommit`, less
`baseline` (dirty at start), **plus** every baseline path whose blob at stop
differs from `baselineState` — `computeReality` with `baselineChanges`. Edited
again, deleted, recreated, or put back to HEAD all count: each is something
the session did to a file the developer had already changed.

Git says only that a file differs from HEAD, never who wrote which hunk, so a
path that is in `reality` this way is counted whole, like any other path. It
drifts if it is outside scope and is in `endState` for outcome and survival.
There is no separate "touched a dirty file" category: that would be a second
view of one fact.

A record without `baselineState` (before 23 September 2026) has nothing to
compare with. Its reality is what it always was — the old subtraction, with
the blind spot — and nothing is inferred to fill it. Never backfill the
snapshot from a later tree: that would describe the wrong instant.

## Per-call snapshots and the racily-clean rule

A tool call's "what changed" is two looks at the tree compared
(`treeStateChanges`). The looks are incremental (`treeStateCached`): a path's
blob from the last look is reused only when its `mtimeNs`, `ctimeNs`, `size`
and `ino` all match **and** its `mtimeNs` is older than the moment that look
began (`writtenAtNs`, taken before any stat). A file whose mtime is at or after
that moment is **racily clean** — written in the same tick the cache was
taken, so its stat can match while its content does not — and is rehashed.
This is git's rule for its index, and it is what makes a cache here safe to
trust: a hit can only ever skip work, never change an answer.

- The path list always comes from git, never the cache: new, deleted and
  reverted paths are always resolved. Non-files are `null` and never cached.
- A cold cache must give exactly `treeStateSince`'s answer; a test pins it.
- Never widen a hit to fewer fields, or drop the time test to save a hash.
  A wrong blob here is a wrong "changed during tool call N" on a signed record.

## Class

Rationale: [What will this one cost?](../../../docs/decisions.md#what-will-this-one-cost).

`classify.ts` is an ordered table of path patterns and nothing else: first match
wins per path, and a session takes whichever class the most of its paths landed
in, ties broken by the order of the table. The table is at the top of the file
so a class can be checked, or a repo's layout added, in ten seconds. Every rule
carries an example, and the tests assert each one — a rule inserted above
another that shadows its example fails there rather than quietly relabelling a
week of sessions.

`other` competes on the same terms as the rest and can win. A session that
mostly touched files no rule recognises is `other`; calling it `ui` because one
stylesheet was in there would be a label made up to avoid admitting a gap. The
fix for a repo that keeps landing in `other` is a line in the table.

`stop` writes the class so the log says what it means on its own, but nothing
depends on the stored field: the rules are pure and `reality` is on the record,
so a session recorded before the field existed is classified from its paths and
gets the same answer.

There is no table over the words of an intent. `INTENT_RULES` read a class off
an intent for `estimate`, and went with it — see Estimate, below. Paths are the
only thing a class is read off.

## Intent source

`declared` was typed at `session start`, before the agent ran. `primed` keeps
the developer's intent verbatim and records that the scope was reviewed with
Prime. `captured` was taken off the first prompt of a session the hook opened.
All three fix the intent before the work and preserve it afterwards. The
distinction is unaided declaration, assisted scope selection, or passive
capture — Prime does not compose the words.

Decided when the session opens and fixed there. `captureIntent` fills in a
passive session's words later; it does not change what kind of intent they
are, and `updateSession` refuses the field outright. A session opened with no
intent is `captured` by construction, and `appendSession` refuses any other
source for it. A new `primed` session must carry its original `proposal`;
other sources cannot carry one. The writer refuses changes to the proposal,
and the reader keeps the creating record's proposal and source even if a later
patch tries to replace them.

Absent on records written before passive capture existed, where it reads as
`declared`: nothing but `session start` could have written an intent then, so
that is a fact about those records rather than a guess about them. Same shape
as `classOf` — every reader goes through `intentSourceOf`, never the raw
field, so those records land in `--intent declared` rather than outside the
groups.

`week <id>` names it, and `week` marks the row, filters on it and prints one
block per source. `INTENT_SOURCES` fixes their order: declared, primed,
captured. Source decisions use exhaustive tables or walk that list; a test
against `captured` alone would silently give a future source the wrong answer.
`sourceHasScope` and `inOwnWords` are separate questions, even though declared
and primed currently answer yes to both.

## Prime

Current rule and workflow: [Prime](../../../docs/prime.md). The original
co-change proposal below remains rejected; the current rule reads repeated
planning misses, not coupling or file popularity.

`proposeScope` is pure. Its eligible history is this repo's closed, unaided
declarations with nonempty scope, ended strictly before the question. Captured
and primed sessions never train it: accepted suggestions cannot become evidence
for the next suggestion. Comparable means two shared content words under the
fixed tokenizer, or an exactly matching scope entry and seed — a wording match,
never semantic understanding or a confidence score.

Suggestions are exact tracked files present in the checkout. Named seed files
come first; historical candidates need at least `PRIME_SUPPORT` (three)
comparable declarations and `PRIME_RATE` (60%) support. A later eligible
unaided declaration covering a path clears its earlier misses. The comparable
count stays the denominator. Historical candidates sort by support, then path;
`PRIME_LIMIT` caps the complete suggestion at five. No parent-directory
roll-up, co-change expansion or arbitrary subset of an overbroad seed. Missing
seeds and seeds covering more than five files cause an abstention.

A preview reads only: no record, store creation or session start. `--start`
computes a proposal for that invocation and accepts it; `--scope` replaces the
whole accepted scope and may name new files. An empty suggestion requires an
explicit replacement to start. The record retains the original proposal whole,
including rule version, intent, suggested scope, supporting ids and counts,
coverage and abstention. It stays unchanged even if every path is replaced.
Only accepted `scope` participates in drift and debt; a suggestion alone clears
neither. Old records are never backfilled.

`evidence/prime-evaluate.mjs` calls the production rule, uses only history that
closed before each target started, and reads the tracked tree at that target's
start commit. No current-tree fallback. Seeded and unseeded results stay apart:
a path supplied by the developer is not a prediction Prime earned. Report
precision, recall, abstentions and tree coverage with their denominators;
recall alone rewards suggesting the whole tree. Missing historical trees are
counted as skipped. Conservative abstention is not evidence of useful
prediction, and results on one repo do not validate the rule on others.

## Scan

`session scan` answers the question the rest of the tool cannot: what have the
agent sessions on this machine already cost, for somebody who has recorded
none of them. No `session start`, no hook, no `~/.session`, nothing to set up.
It is the only command that is useful before the tool is adopted, and the
only one that must stay useful to somebody who never adopts it.

**Read-only, and that is the whole promise.** It writes no record, touches
nothing under `~/.session`, and modifies no repo — it opens transcripts, asks
git questions, and prints. A test asserts the repo is byte-identical
afterwards, because the moment this command writes something it becomes a
thing you have to opt into, which is what it exists not to be.

One transcript is one session. That is a different unit from the adapter,
which folds every transcript in a window into the one session somebody
declared — but the reading underneath is the same reading.
`capture/transcript.ts` holds what a line means: calls keyed by `requestId` so
streaming fragments collapse, the four counters kept apart, turns cut at
developer-authored entries. Two parsers would have the tool quoting two
figures for the same work with nothing to say which was right.

Transcripts are **streamed**, a line at a time. They reach fourteen megabytes
and a scan opens every one of them; `readFile` over a directory of them is
hundreds of megabytes held at once to answer a question that never needs two
lines together.

The label is the session's first prompt, because a transcript says nothing else
about what the work was for — nothing was declared, so there is no intent to
quote. Note the label and the turn boundary are separate questions: `/clear`
starts a turn and will never be a label, and keeping them apart is what stops a
nicer label moving a cost figure.

**Nothing here says `merged`.** Where the repo is a checkout, `scan` asks git
which commits reached the default branch and reports how many sessions were
running when one did. That is a coincidence in time. `outcome.ts` earns the
word merged by finding the blob a session left in the branch's history, and
`scan` has no diff to do it with — so the report says "overlapped a commit"
and the HTML page leaves the outcome cell `open`. A checkout that could not be
asked is counted apart from one that said no: not knowing where work went is
not the same answer as knowing it went nowhere.

The dearest three are ranked over the sessions that could be priced, and how
many could not is printed beside them. "The three most expensive" is a claim
about an order; a session with no rate has no place in it, and putting it last
would say it was cheap.

## Debt

Rationale and a worked report:
[The files nobody plans for](../../../docs/decisions.md#the-files-nobody-plans-for).

`debt.ts` is a query over `drift` and `scope`, both already on the record.
Nothing new is measured, and no model is asked whether a file is bad code — the
only claim is that work keeps landing where nobody planned it.

Four thresholds, and each is a refusal to say more than the log supports:

- **Three drifts.** Once is an accident, twice a coincidence. `MIN_DRIFTS`.
- **A later declaration clears it**, through the same `covers` rule `stop`
  computes drift with — `src/api/` clears every file under it. *After* is
  decided by position in the session list, which is why `debtOf` documents that
  it wants them oldest first. A file declared and then drifted onto again is
  owed again. A scope accepted through Prime counts here; `proposal.scope`
  never does. This differs from Prime's training rule, which admits only
  unaided declarations.
- **Docs, config and build are never listed**, by `classOfPath` and no second
  list of exceptions. They are touched by everything and owned by nobody, and
  left in they bury every path that means something.
- **Under three sessions of history, no answer at all.** `RepoDebt.files` is
  *absent*, not empty — "found nothing" and "could not look" are different
  statements.

**Asked from `prime`.** The preview prints this repo's owed files — at most
`DEBT_SHOWN`, paths and session counts, no money — under the suggestion, and
says so when the history is too short. `debtHere` in `commands/prime.ts` reads
this checkout's log only. The list is never part of the proposal and never
recorded: Prime's rule and the debt rule stay two rules, and neither clears
the other. `session prime --debt`, on its own, prints the whole report, every
repo on the machine.

**Per repo, never pooled.** The same path means different things in two
codebases, and grouping happens in the pure half so no caller can pool by
accident. Repos sort by name: ranking them would be the aggregation this
refuses, arriving by way of a sort.

Grouping is on `session.repo` *after* the reader has merged the logs of a repo
that changed identity — see `One repo, two logs` in the `sync-and-chain` skill.
Two half-histories under two names are the failure this floor turns into its
worst form: months of sessions, split, each half under three, and a report
saying it cannot judge.

The cost column is the whole cost of every session that touched the file, never
a share of one — there is no way to divide a session's tokens between the files
it changed. So the column does not add up, nothing offers a total for it, and
the note under the table says so. It uses its own `spendOfDebt` rather than
`spendOf`, because that one splits money by `outcome`, and `debt` reads logs
from repositories it is not standing in and so cannot recompute one — see the
top of this file. Unpriced sessions are counted and named as everywhere else,
and a file nothing could be priced for reads `—`.

## Co-change — removed, do not reintroduce

Full reasoning: [Rejected](../../../docs/decisions.md#cochange--the-files-that-move-together).

`session cochange` shipped and was cut before 1.0, with `src/cochange.ts`,
`partnersOf`, `MIN_TOGETHER` and `MIN_RATE`. It counted, per pair of paths, the
sessions that changed both over the sessions that changed the commoner of the
two.

**Why it went.** It read `reality` and nothing else, so no declaration entered
the arithmetic and nothing it printed could be a planning failure — what it
ranked was which files are central. `debt` reads `drift`, which is `reality`
less what was declared, and that subtraction is the whole difference between
the two reports. Its one consumer was the original co-change version of
`prime`, also rejected, after which `partnersOf` had no caller but its own
tests. The current Prime rule above does not restore that consumer or its
coupling inputs.

**The rule.** No view returns that reads coupling, centrality, or how often two
paths appear together, and nothing derives a scope suggestion from one. A
report over `reality` alone is a fact about the tree; this tool measures the
distance between a declaration and a diff. Note the `MIN_RATE`
commoner-denominator guard is *not* what failed — don't bring the report back
on the strength of a better denominator.

What survives is in `debt`: `readAllSessions` over every log on the machine,
`IGNORED_CLASSES`, `MIN_HISTORY`, per repo and never pooled, absent rather than
empty under the floor. The rule that a checkout which could not be asked is not
a checkout that said no survives in `survival` and `scan`.

## Survival

Rationale and a worked report:
[Did it stick?](../../../docs/decisions.md#did-it-stick).

The one figure in this tool that is **not** recomputed on every view, and the
reason is the whole design: the branch tip says what it holds today and nothing
says what it held on the fourteenth day after a merge. A file rewritten in week
three and restored in week six is indistinguishable from one nobody touched. So
the check runs on a schedule and is written to the log as a signed record, per
path, stamped with the day and the commit — `session survival --check`. Never
turn this into a live computation, and never revise an observation once
written: a survival record that could be rewritten is worth what recomputing it
is worth, which is nothing.

Per path: `survived` (still the blob the session left), `rewritten` (something
else), `deleted` (nothing there). A session that deleted a file survives by the
file staying gone, and something back at the path is that deletion undone —
`rewritten`, since from here they are the same event.

Windows are `SURVIVAL_WINDOWS` (14 and 30), counted from **the first
observation saying `merged`**, not from `endedAt` and not from any commit date.
Nothing on disk records when a merge happened — a squash writes a new commit
with its own dates — so what is counted from is the day somebody looked. A
session no `settle` has dated is `unsettled` and is counted, never guessed at.

Five states, and each is printed rather than collapsed:

- `measured` — on the record.
- `pending` — merged too recently for the window to have closed. **Never a
  failure and never in the denominator.** Counting it would make the rate fall
  on every merge and recover a fortnight later, and the movement would be the
  calendar.
- `due` — closed, within `CHECK_GRACE_DAYS`, still answerable. The one
  actionable state; the view names the command.
- `missed` — closed longer ago than that. **Not checked late**: the tip now is
  not evidence about then, and answering anyway would file today's branch as
  that day's. Counted and named, which is what an adopter with a backlog of old
  merges is owed.
- `unsettled` — merged, but nothing records when.

Both `settle` and the due checks also run **automatically**, once a day per
repo, from the `SessionEnd` hook and opportunistically from `week`, `week <id>` and
the bare screen — `commands/sweep.ts`. Rules that hold there: silent unless
something was written; the once-a-day stamp goes down *before* the work, so a
cancelled sweep waits for tomorrow rather than retrying on every command; it
never fails its host command; and it gathers `RepoFacts` once and hands them to
the view, since gathering twice in one command doubles the most expensive thing
this tool does. Don't make it chatty, don't let it throw, and don't add a second
gather.

The rate is over **paths, not sessions** — a session that touched forty files
is forty files' worth of evidence — while `MIN_SESSIONS` still counts sessions,
since what has to be numerous enough to generalise from is the work. Below it,
the count prints and no rate does. Declared, primed and captured are separate
source lines and never a pooled source rate. Every source prints even when it
holds nothing — dropping one would leave the others reading as the whole
answer.

`SURVIVAL_BENCHMARK` is one constant, quoted from both ends: churn here is
exactly the share that did not survive, so 90% survival and 10% churn are the
same line. Two constants would be two things to keep in step. It is somebody
else's published figure, not a measurement — it is there so a reader has
something to sit their own figure against.

## Estimate — removed, do not reintroduce

Rationale: [What will this one cost?](../../../docs/decisions.md#what-will-this-one-cost)
and [the v1 boundary](../../../docs/decisions.md#the-v1-boundary).

`session estimate` restated past sessions of a class as a median, p90,
first-time merge rate and drift, one block per source. Cut on 21 September
2026 with `src/estimate/`, `render/estimate.ts`, `INTENT_RULES` and
`classifyIntent`. Every figure it printed is still on the record for `week`.
`MIN_SESSIONS` survives in `survival.ts`, where the survival rate uses it.

**The rule.** No view returns that projects a cost from past sessions, and
nothing reads a class off the words of an intent.

## Cost in money

Rationale and the file format:
[What it cost](../../../docs/decisions.md#what-it-cost) and
[Where the prices come from](../../../docs/decisions.md#where-the-prices-come-from).

An unpriced session names the model wherever one is reported: `week`'s cost
cell, `scan`'s note, and `stop`'s cost line all read `<n> tokens, <model>
unpriced`, from `unpricedTokens` in `render/terminal/cost.ts`. The model is the
only actionable part — the reader's next move is to put a rate against that
name. Note `stop` reports tokens and not money, and says nothing about pricing
at all when it was handed no rate table: "unpriced" would then mean "nobody
asked", which is a different fact.

`pricing.ts` is the only file that knows a price. Everything above `loadRates`
is pure: `priceTokens`, `rateFor`, `priceSession`, `spendOf`, `formatUsd`.

Prices are **data**, not code — `rates.json` beside the package, merged entry by
entry with `~/.session/rates.json` if there is one. A model in neither is
reported unpriced, with its tokens and its name. Never price an unknown model at
the nearest model's rate: the figure goes on invoices, and an admitted gap beats
a plausible wrong number. Match exactly, or by the longest key that is a prefix
**at a dash** — transcripts report dated ids, and without the dash
`claude-opus-4` would price `claude-opus-45`.

The bundled table carries the current Claude and OpenAI models and the older
ones a log may still hold, and it says on its face that prices go stale and
where to check them — the numbers are a snapshot of somebody else's price list,
and a release of this tool is not a price update. Nothing in the code reads
those keys; they are there for the person who opens the file.

A model in neither file is not sent away with the name of a file they have
never opened. `rateStub` returns **the whole document**, with the model already
in it and every field present, so the answer to an unpriced week is a paste and
four numbers. The noughts in it are placeholders and the file says so: pasted
unchanged they would price the model at nothing, and nought is not unknown —
see below. It is one function, and the fields come off the same list `readRate`
checks against, so a stub this tool prints cannot be one this tool rejects.
Never fill a stub in with a nearby model's price; that is the guess the
paragraph above refuses to make, arriving by another door.

`emptyTurnTokens` is measured, not apportioned. Where every turn was empty it
is the session's own total, because every token it moved was moved in a turn
that ended with nothing written; taking the session total times `emptyTurns /
turns` would look like a measurement and would not be one. Empty turns are not
average turns — the expensive one is the whole point. Don't "simplify" this
into a ratio, and don't backfill it onto records that predate it.

## Which turns produced nothing

**Settled against the diff, never against tool names.** `empty.ts` is the one
rule and every view goes through it — `emptyTurnsOf`, `emptyTokensOf`,
`emptyTurnsTotal`. Nothing reads `cost.emptyTurns` directly: what that field
means depends on which rule wrote it.

The rule this replaced asked the transcript whether a turn contained an `Edit`,
`Write`, `MultiEdit` or `NotebookEdit` block. A transcript records which tool
was called, not what the call did to the disk, and agents write files through
`Bash` constantly — 2,414 `Bash` calls against 657 `Edit` and 198 `Write`
across 27 real transcripts. So sessions that changed seven files were recorded
as seven files' worth of nothing, at 100% waste, on a signed append-only
record. Never reintroduce a tool-name test, and in particular never "fix" this
by adding `Bash` to the set: that inverts the error, and an `emptyTurns` that
is always nought is worse than one sometimes wrong, because nothing on the page
would show it had stopped measuring.

Three cases, and `stop` is the only place the first two are decided —
`reconcileEmpty`, where the diff is already in hand:

- **The session changed nothing.** Every turn produced nothing, and every token
  went on one. Both figures are measurements.
- **The session changed files.** *Which* turn wrote them is not on the record
  and cannot be recovered: a diff is one answer for the whole session. No
  figure, and no nought standing in for one.
- **A record from the old rule** (`emptySource` absent, reading as `tools`)
  keeps its figure — for a session that really used `Edit` it is right — except
  where git refutes it outright: a session that changed files cannot have had
  every turn produce nothing.

`callsWithoutEdits` is **never written and never displayed**. It was the same
guess at a grain git cannot help with at all. The field stays on the type so
old records still hash back under `verify`.

`scan` has no figure here at all, and its report carries no `emptyTurns` and no
`emptyUsd` field. It reads transcripts and has no base commit to diff against —
the same refusal that keeps the word `merged` out of that report. It says so on
its own line rather than dropping it, since a report that printed nothing would
read as a window in which nothing was wasted.

Views render the absence rather than a nought: `unknown` in `week`'s `no edits`
column, a note under the blocks naming how many sessions could not be counted,
`not measured` in `week <id> --full`'s `no edits` row, and one figure fewer
in the brief line and in the pull request body — the same rule as
[A total nobody can work out](#a-total-nobody-can-work-out).

## A category with no members

No money figure stands in for a category that is empty. `week` says `$X spent,
all of it shipped` rather than `$0.00 of it on changes that never merged` — a
nought there is a number the reader has to decode into "none", and a nought is
what this tool prints when it means *unknown*.

"All of it shipped" is only said when every priced dollar sat on a session
that merged. Sessions that changed no files are kept out of `unmerged` — they
had nothing to land — which leaves a window of nothing but those looking like
a clean sweep. `spendOf` therefore reports their spend as `empty`, apart from
both, and a window with any of it says `none of it on changes that never
merged` instead. Both counters are exactly zero when no such session
contributed, so the test never rests on comparing two sums of floats.

It is one function, `shippedNote` in `pricing.ts`, called by `week` and by the
page `week --open` writes. Two copies would be two chances for the terminal
and the page to say different things about one window.

## A total nobody can work out

**Nought is not the same as unknown, and no view may print the first when it
means the second.** `spendOf` totals what it can price and counts what it
cannot, so a window where nothing could be priced comes back as `usd: 0` with a
count beside it. Rendering that as `$0.00` is the worst kind of wrong: it has
the shape of an answer, it goes into somebody's meeting notes or invoice, and
it says a week cost nothing when what happened is that nobody knows what it
cost.

The test is `usd === 0 && (unpriced > 0 || uncaptured > 0)`, never `usd === 0`
alone. A window that genuinely cost nothing — sessions that ran, on models with
rates, whose tokens came to nothing — reads `$0.00`, correctly, and that is the
case the other clauses protect. Getting it the other way round is the same
defect inverted: an em dash written over a column of noughts is a total the
reader can see does not add up.

**Two ways to have no figure, counted apart.** `unpriced` is a model no rate
covers, and a rate fixes it. `uncaptured` is a session with no turns on the
record — nothing was found to price, no model to name, and no rate would fill
it. Neither is a dollar, so both keep a window off `$0.00`; but a note that
pooled them would send somebody to `~/.session/rates.json` to add a price for a
model called `unknown`. Every view names them apart.

It is one function, `unpricedThroughout` in `pricing.ts`, and every view calls
it rather than spelling the clauses out again. A test copied into three
renderers is three chances for them to come to disagree about what a week cost,
and the clause that gets dropped in the copying is never the first one. It
takes the fields it reads rather than a whole `Spend`, so `scan` — which has no
`unmerged` to report — is held to the same rule; `uncaptured` is optional
there, because a scanned transcript is a session *because* it has turns in it.

**`wasMeasured` is the same rule at the grain of one session, and it is turns
and nothing else.** A session with no turns had no transcript found for it, and
every counter on it is a nought nobody measured — so it gets no figure on any
surface: `unknown` in `week`, `not captured` in `--md`, no cost rows in `week <id>`,
a dash on the page. It may well have changed files and been billed for them:
the diff at `stop` sees those whether or not an adapter saw anything, which is
why "it changed nothing" is neither the reason nor the test. A session that has
turns and prices to nought keeps `$0.00` — that figure was measured. Don't
widen this back to `turns > 0 || apiCalls > 0`: calls without turns are the
same absence wearing a counter.

Every view that renders a total obeys this, and each has a test pinning both
halves — the window nobody can price, and the window that genuinely cost
nothing:

- `--md` says `cost unavailable — no rate for <model>` where the headline would
  have carried the money, and an em dash in the total row where the figure
  would have gone. The note below drops its "the cost above covers…" wording
  in this case, since it would point at a figure the document deliberately did
  not print, and says how many sessions and what to do instead.
- `week` in the terminal puts `NO_PRICE` in its closing line — the one total
  it has, since its source blocks carry no money — in place of the figure,
  leaving the `N sessions unpriced: <models>` and `N sessions uncaptured: no
  turns on the record` lines to say why. A week that genuinely cost nothing
  closes at `$0.00`, like the rows above it. Every row reading `unknown` in the
  cost column is counted by one of those two notes: a cell that says nothing
  under a footer that counts nothing is a hole the reader can see and the view
  will not admit to.
- `week --open` leaves the money out of the page's summary rather than
  printing a nought into it — and keeps `$0.00` in the summary for a week that
  genuinely cost nothing, since a page that dropped the figure in both cases
  would render the absence and the nought identically and have no way left to
  say which it meant.
- `scan` prints the same dash in its `spent` line and omits the waste figure
  with it: a share of a total that does not exist is not a figure either.
- `--md`'s note about the sessions that changed no files says `costing an
  amount no rate covers (<model>)` rather than dropping the clause, or `and
  nothing was captured to say what they cost` where there is no model to name.
  Those sessions are not in the table, so the coverage note above never counts
  them — this line is the only place the document can admit that part of the
  bill has nothing behind it, and a clause dropped because nothing was spent
  would read the same as one dropped because nothing could be worked out.

The cost-per-shipped-change line in `--md` falls out of the same rule for free:
its guard is `usd === 0`, so a window nobody can price has no ratio either.

The cost-per-shipped-change line is omitted when nothing merged, rather than
dividing by zero or printing a dash: a dash in a cost line reads as a figure
somebody failed to compute, and the honest statement is that the week has no
such figure. Its numerator is the whole week, not the merged sessions' own
spend — money that went into attempts that never landed is part of what the
changes that did land cost.
