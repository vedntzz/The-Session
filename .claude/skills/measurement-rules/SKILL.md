---
name: measurement-rules
description: Load when changing how a session's outcome, class, intent source or cost is decided or displayed — editing outcome.ts, classify.ts, observe.ts, pricing.ts, scan.ts, rates.json, or commands/estimate.ts; adding a class rule or a model price; touching a view that prints money, a median, a merge rate, a drift figure, or any total that might have nothing behind it. Also load before "simplifying" a figure, apportioning one counter from another, or making an unpriced total read as zero.
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

`outcome` on a stored record is not what any view shows. `show` and `week` run
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
in `week` (they had no change to land — the money is still in the total), and
`estimate`'s sample, median, p90, drift and first-time merge rate. They are
counted and named in both places rather than dropped quietly. What they are
not excluded from is what they cost: that was spent.

Note an empty session is not the same as one that touched files and left no
end state for any of them — that one attempted something, and `classify`
reports it abandoned. `attemptedNothing` is the whole test, and it is false
while a session is still running: a session that has changed nothing *yet* is
`open`.

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

`INTENT_RULES` is the same table over the words of an intent, for `estimate`,
which is asked before there are any paths. It is the weaker signal and is only
ever used on a question, never on a session that ran — anything that has
stopped has `reality`, and paths beat words. Nothing merges the two: a class
comes from one table or the other, and the command says which.

## Intent source

`declared` was typed at `session start`, before the agent ran. `captured` was
taken off the first prompt of a session the hook opened. Both are written
before anything happened and neither can be edited afterwards, so invariant 1
holds for both — but only one of them was ever a promise, and a reader
comparing intent to reality is owed that.

Decided when the session opens and fixed there. `captureIntent` fills in a
passive session's words later; it does not change what kind of intent they
are, and `updateSession` refuses the field outright. A session opened with no
intent is `captured` by construction — recording it as `declared` would be a
claim that somebody typed it — and `appendSession` refuses the combination.

Absent on records written before passive capture existed, where it reads as
`declared`: nothing but `session start` could have written an intent then, so
that is a fact about those records rather than a guess about them. Same shape
as `classOf` — every reader goes through `intentSourceOf`, never the raw
field, so those records land in `--intent declared` rather than in neither
half.

`show` names it, `week` marks the row and filters on it, and `estimate`
reports the two apart. Nothing pools them.

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
  owed again.
- **Docs, config and build are never listed**, by `classOfPath` and no second
  list of exceptions. They are touched by everything and owned by nobody, and
  left in they bury every path that means something.
- **Under three sessions of history, no answer at all.** `RepoDebt.files` is
  *absent*, not empty — "found nothing" and "could not look" are different
  statements, the same distinction `EstimateGroup.figures` makes.

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

The rate is over **paths, not sessions** — a session that touched forty files
is forty files' worth of evidence — while `MIN_SESSIONS` still counts sessions,
since what has to be numerous enough to generalise from is the work. Below it,
the count prints and no rate does, exactly as in `estimate`. Declared and
captured are separate lines and never a total, and a block holding nothing
still prints, for the reasons under Estimate.

`SURVIVAL_BENCHMARK` is one constant, quoted from both ends: churn here is
exactly the share that did not survive, so 90% survival and 10% churn are the
same line. Two constants would be two things to keep in step. It is somebody
else's published figure, not a measurement — it is there so a reader has
something to sit their own figure against.

## Estimate

Rationale: [What will this one cost?](../../../docs/decisions.md#what-will-this-one-cost).

`session estimate "<intent>"` answers it with past sessions of the same class:
count, median, p90, how often they merged the first time anyone looked, and the
paths that kept turning up as drift. The class comes from `--class` if it is
given, else `--scope` through the path rules, else the intent through the
keyword rules — and the output names which, so a wrong class is visible rather
than buried in the figures.

Nothing is projected. Every figure is a restatement of sessions that already
ran, which is also why the sample is printed above the figures and why fewer
than five sessions reports the count and nothing else — a median of two looks
like knowledge and is not.

The answer is two blocks, one per intent source, and never a total. Declared
and captured sessions are different evidence and on most logs they do not cost
the same or land at the same rate; a pooled median describes neither, and it
would move whenever the mix moved with nothing in the output to say that was
what changed. Teams adopting the hook record far more captured sessions than
declared ones, so the pool would be dragged wherever the hook happened to
point.

`MIN_SESSIONS` therefore applies to each block on its own. Six declared and
six captured sessions are not twelve of anything, and a threshold that let
them add up would be the pool again under another name. A block holding
nothing still prints — dropping it would leave the other reading as the whole
answer, which is the pooled reading this exists to prevent.

Drift is finally counted over a plain denominator, because every session
behind the declared block declared a scope. The captured block says outright
that there was nothing to drift from rather than printing no drift line: a
missing line there reads as captured sessions never drifting.

`--since` is printed once, above both blocks. Twice would suggest the two
could have been cut at different dates.

The percentile is nearest-rank: p90 is an amount some session was actually
billed, not one interpolated between two of them. "First time" means the first
terminal observation on the record, or the outcome computed now for a session
nobody has settled — a session abandoned and revived a month later merged, but
it did not merge the first time.

Sessions that changed no files come out before anything is counted, and the
count of them is printed beside the sample of the block they came from — how
often a session comes to nothing is not the same question for work somebody
declared and work the hook happened to catch. They are not instances of the work
being asked about: they would drag the median below anything anyone was billed
for doing it, and sit in the merge rate's denominator as failures to merge
when there was nothing to merge. Note they mostly land in `other`, since a
session with no paths has nothing to read a class off — which is exactly the
estimate they would otherwise swamp.

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

`emptyTurnTokens` is measured, not apportioned. The adapter knows which turn
each call belonged to, so it adds the empty turns' tokens up directly; taking
the session total times `emptyTurns / turns` would look like a measurement and
would not be one. Empty turns are not average turns — the expensive one is the
whole point. Don't "simplify" this into a ratio, and don't backfill it onto
records that predate it.

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

The test is `usd === 0 && unpriced > 0`, never `usd === 0` alone. A window that
genuinely cost nothing — nothing captured, so no rate missing — reads `$0.00`,
correctly, and that is the case the second half of the test protects. Getting
it the other way round is the same defect inverted: an em dash written over a
column of noughts is a total the reader can see does not add up.

It is one function, `unpricedThroughout` in `pricing.ts`, and every view calls
it rather than spelling the two clauses out again. A two-clause test copied
into three renderers is three chances for them to come to disagree about what a
week cost, and the half that gets dropped in the copying is always the second
one. It takes the two fields it reads rather than a whole `Spend`, so `scan` —
which has no `unmerged` to report — is held to the same rule.

Every view that renders a total obeys this, and each has a test pinning both
halves — the window nobody can price, and the window that genuinely cost
nothing:

- `--md` says `cost unavailable — no rate for <model>` where the headline would
  have carried the money, and an em dash in the total row where the figure
  would have gone. The note below drops its "the cost above covers…" wording
  in this case, since it would point at a figure the document deliberately did
  not print, and says how many sessions and what to do instead.
- `week` in the terminal puts `NO_PRICE` in the total row and omits the
  `… spent` line entirely, leaving the `N sessions unpriced: <models>` line to
  say why. A week that genuinely cost nothing totals `$0.00` there, like the
  rows above it.
- `week --open` leaves the money out of the page's summary rather than
  printing a nought into it — and keeps `$0.00` in the summary for a week that
  genuinely cost nothing, since a page that dropped the figure in both cases
  would render the absence and the nought identically and have no way left to
  say which it meant.
- `estimate` prints `no price for any of these models` in place of the median
  and p90.
- `scan` prints the same dash in its `spent` line and omits the waste figure
  with it: a share of a total that does not exist is not a figure either.
- `--md`'s note about the sessions that changed no files says `costing an
  amount no rate covers (<model>)` rather than dropping the clause. Those
  sessions are not in the table, so the unpriced note above never counts them
  — this line is the only place the document can admit that part of the bill
  has no rate behind it, and a clause dropped because nothing was spent would
  read the same as one dropped because nothing could be priced.

The cost-per-shipped-change line in `--md` falls out of the same rule for free:
its guard is `usd === 0`, so a window nobody can price has no ratio either.

The cost-per-shipped-change line is omitted when nothing merged, rather than
dividing by zero or printing a dash: a dash in a cost line reads as a figure
somebody failed to compute, and the honest statement is that the week has no
such figure. Its numerator is the whole week, not the merged sessions' own
spend — money that went into attempts that never landed is part of what the
changes that did land cost.
