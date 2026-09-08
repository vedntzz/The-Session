# Context

What `session` is, as the repository actually stands.

Every figure below is followed by the command that produced it and that
command's real output. Nothing here is typed from memory and nothing is
summarised from a conversation: a number that has gone stale can be caught by
running the line printed above it.

Derived at `a9204cb docs: define what 1.0 means, surface frozen at twenty verbs` (`v0.9.0-7-ga9204cb`).

This replaced a summary that lived only in a chat log and was three releases
out of date before anyone noticed. The rule that follows from that: **this file
is re-derived, not edited.** The invariants, the measurement rules, the record
shape and the command list are copied out of the files that own them, and each
section names its source, so regenerating beats amending.

| what | lives in |
|---|---|
| Invariants | [`Claude.md`](../Claude.md) |
| Measurement rules | [`.claude/skills/measurement-rules/SKILL.md`](../.claude/skills/measurement-rules/SKILL.md) |
| The record | [`src/store/record.ts`](../src/store/record.ts) |
| The command surface | the `commander` tree, via [`evidence/verbs.mjs`](../evidence/verbs.mjs) |
| Why any of it is this way | [`docs/decisions.md`](decisions.md) |

---

## What it is

A CLI that records AI coding sessions. The developer declares intent before an
agent runs; the tool records what actually happened. The gap between the two is
the product.

```console
$ npm pkg get name version engines dependencies
{
  "name": "@vedantzz/session",
  "version": "0.9.0",
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "picocolors": "^1.1.1"
  }
}
```

```console
$ npm ls --omit=dev --depth=0
@vedantzz/session@0.9.0 /Users/vedant/dev-session
├── commander@14.0.3
└── picocolors@1.1.1
```

Two runtime dependencies, Node 20 or newer, ESM. No build step beyond `tsc`, no
bundler, no monorepo.

```console
$ find src -name '*.ts' | wc -l && find src -name '*.ts' -exec cat {} + | wc -l
      95
   14637
```

```console
$ find test -name '*.ts' | wc -l && find test -name '*.ts' -exec cat {} + | wc -l
      38
   16514
```

95 source files at 14,637 lines against 37 test files at 16,440 — more test than
source, which is the intended ratio: *prefer adding a test over adding a log
line*, from Style in `Claude.md`.

## The five invariants

Copied verbatim from `Claude.md`, which owns them — extracted with
`awk '/^## Invariants/,/^## Stack/' Claude.md`. Everything else in this
document is downstream of these.

1. **`intent` is immutable.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation. No `--edit-intent` flag, ever.
2. **No server, no database, no account.** Data lives in JSONL on the user's disk. `sync.ts` moves records over a git remote the team already has, by git talking to git — nothing this project runs is a service, and anything needing one is wrong.
3. **Deterministic only.** File diffs, test exit codes, token counts from the transcript. No LLM is called to judge whether code is good, whether scope was met, or what a session "meant" — nor to write prose about any of it. `session pr` is the standing test of this: a pull request body is exactly where a generated paragraph would be most welcome and most expensive, so it is a transcription of the record and nothing else.
4. **Turns that produced nothing are first-class.** Turns that changed no files are counted and displayed, never dropped — and where the record cannot say which turns those were, *that* is displayed rather than a nought. A transcript names the tool a call used, never what it did to the disk, so the question goes to git: `empty.ts` is the one rule, and no view reads `cost.emptyTurns` itself.
5. **Cross-tool.** Nothing may assume Claude Code specifically. Adapters go behind an interface; the core reads a normalised shape.

## The surface

Frozen at twenty verbs. Read from the real `commander` registration tree by
walking `buildProgram().commands` — not from `--help`, which is a filtered view
of it, and not from the Readme, which is prose.

```console
$ node evidence/verbs.mjs
top-level verbs:        20
including subcommands:  24

start [intent]            Begin a new session
                          --scope <paths...>  --passive
intent                    For the editor hook: record the first prompt as an undeclared session's intent
                          --from-prompt
stop                      End the active session
                          --if-open
show [id]                 Show the last closed session
                          --full  --tokens
week                      Summarize recent sessions, one row each
                          --days <n>  --client <name>  --project <name>  --outcome <state>  --class [name]  --intent <source>  --tokens  --md  --copy  --open
pr [id]                   Write a pull request body from a session's record
                          --copy  --out <path>  --template <path>
scan                      What the agent sessions already on this machine have cost — no setup needed
                          --days <n>  --repo <path>  --open
debt                      Files that keep drifting outside the plan and are never declared, per repo
estimate <intent>         What sessions like this one have cost, from the ones already recorded
                          --scope <paths...>  --class <name>  --since <when>
verify                    Check a log's hash chain and signatures
                          --log <path>  --key <path>  --peers
settle                    Record where every finished session ended up, as a signed observation
mark <id> <outcome>       Say where a session ended up, overriding what the repo suggests
survival                  How much of what merged is still there, at 14 and 30 days
                          --check
push                      Publish this machine's records to origin, on a ref of their own
pull                      Fetch every key's records from origin. Nothing is merged into your log
peers                     The keys whose records are on this machine, and what they hold
config                    Attribution for this repo, in .session.json — checked in, shared by the team
config set <key> <value>  Set an attribution field, recorded by every session from now on
config show               Print the attribution this repo declares
key                       The signing key this machine writes with
key show                  Print the public key, for anyone who wants to check the log
hook                      Manage the editor hook that closes sessions
hook install              Register the Claude Code hooks that open and close sessions
                          --uninstall  --passive [yes|no]  --no-passive
help [topic]              Every command, not just the ones above
```

Twenty top-level verbs; twenty-four rows because `config`, `key` and `hook`
each carry subcommands. `session --help` deliberately lists only `start`,
`week`, `help all` and the bare screen — a decision about what a first reader
can use, not a claim about what exists. `session help all` lists every one, and
is built by walking this same tree, so a command renamed cannot fall off it.

The count is pinned by a test, not only by this document: `test/program.test.ts`
asserts *registers exactly the twenty subcommands* against a sorted list of
names, so a twenty-first fails the suite.

### What 1.0 means

Verbatim from `docs/decisions.md`:

**The surface is frozen at twenty verbs.** No new commands after 1.0 — refinement only: bugs, documentation, error messages, and making what is already there clearer.

Two exceptions, named here so that nothing else can be argued into the same shape later:

- **A GitHub Action that posts the record on a pull request.** `pr` already writes it; this puts it where the review happens.
- **A team view over the peer records `pull` already fetches.** They are on the machine and nothing reads them together.

Neither is a new measurement. Both are a surface onto what the tool already records.

The reason is that the surface outgrew the story once already, and not narrowly. `prime` was measured and never shipped; `cochange` shipped and was cut. The same fault both times: each measured something other than the distance between a declaration and a diff, and it took a backtest and a fold to see it.

A freeze written down is worth more than one I remember. The next good idea will arrive with a rationale, and the rationale is the part I am bad at refusing.

## The record

One JSON object per line, append-only, hash-chained and signed.

```console
$ grep -n 'SESSION_HOME' src/store/paths.ts
131:  return options.home ?? process.env["SESSION_HOME"] ?? path.join(homedir(), ".session");
```

```console
$ grep -n 'export const REF_PREFIX' src/sync/refs.ts
42:export const REF_PREFIX = "refs/session/";
```

```console
$ grep -n 'ATTRIBUTION_KEYS = ' src/config.ts && grep -n 'CONFIG_FILE = ' src/config.ts
28:export const ATTRIBUTION_KEYS = ["client", "project", "sow", "billingCode"] as const;
33:export const CONFIG_FILE = ".session.json";
```

Storage is `$SESSION_HOME`, else `~/.session/<repo-hash>.jsonl`. Records move
between machines over `refs/session/<fingerprint>` and nothing else — git
talking to git, per invariant 2. Attribution lives in a checked-in
`.session.json` and is the only thing `session config` may ever hold.

Verbatim from `src/store/record.ts`:

```ts
export interface Session {
  id: string;
  /** Normalized repo identity, e.g. `remote:github.com/acme/tool`. */
  repo: string;
  /**
   * What the session set out to do. Written once, never edited.
   *
   * `null` only on a passively opened session that has not seen a prompt yet,
   * and only until the first one arrives. A session that ended without one
   * keeps it: nothing was declared and nothing was asked, and writing words
   * there afterwards would be inventing them.
   */
  intent: string | null;
  /**
   * Which of the two `intent` is. Absent on records written before passive
   * capture existed, where it reads as `declared` — nothing but `session
   * start` could have written one then, so this is a fact about those records
   * rather than a guess about them.
   */
  intentSource?: IntentSource;
  /** The paths the developer declared. May be empty. */
  scope: string[];
  /**
   * Paths already modified when the session opened. Subtracted from `reality`
   * so a session is not blamed for work that was sitting there before it.
   */
  baseline: string[];
  /** The paths that actually changed, observed from git. */
  reality: string[];
  /** `reality` minus `scope` — recorded, never blocked. */
  drift: string[];
  /**
   * What the session was mostly working on — schema, api, ui, test, config,
   * docs, build, other — derived from `reality` at `stop` by the path rules in
   * `classify.ts`. Absent on sessions stopped before it existed; readers
   * derive it from `reality` instead, which is the same computation.
   */
  class?: SessionClass;
  cost: SessionCost;
  outcome: SessionOutcome;
  /** ISO-8601 timestamp. */
  startedAt: string;
  /** ISO-8601 timestamp. `null` means the session is still running. */
  endedAt: string | null;
  /**
   * The blob id of each `reality` path as the session left it, captured at
   * `stop`. `null` means the session deleted the file.
   *
   * This is what makes an outcome decidable later. Whether the work merged is
   * a question about content — a squash merge keeps none of the original
   * commits — and without a record of what the session actually left there is
   * nothing to go looking for. A fact about what happened, like `reality`, not
   * a conclusion drawn from it. Absent on sessions stopped before it existed.
   */
  endState?: Record<string, string | null>;
  /**
   * Where the session was observed to have ended up, oldest first. Written by
   * `session settle` and `session mark`; never the basis for display, which is
   * computed afresh. See `outcome.ts`.
   */
  observations?: Observation[];
  /**
   * Whether what merged is still there, checked at 14 and at 30 days past the
   * merge and written down, oldest first.
   *
   * Unlike `outcome`, this one cannot be recomputed. The branch tip says what
   * is there today; a file rewritten in week three and restored in week six
   * looks untouched to anybody asking afterwards. So the answer only exists if
   * somebody wrote it down on the day — which is what makes this a record
   * rather than a cache. See `survival.ts`.
   */
  survival?: SurvivalObservation[];
  /** HEAD when the session opened, so its diff can be recovered later. */
  startCommit: string;
  /**
   * Who the work was for, copied out of the repo's `.session.json` when the
   * session opened. Absent when the repo declares none.
   *
   * A copy, not a reference: a session records what the repo said at the time
   * it ran. Re-reading the file at display time would let a change of client
   * today rewrite who last quarter was billed to.
   */
  attribution?: Attribution;
}
```

## Measurement rules

What the tool is allowed to claim it measured, and how each figure is arrived
at. Copied verbatim from the skill that owns them, headings demoted one level
to nest here and its relative links repointed at this directory.

```console
$ wc -l .claude/skills/measurement-rules/SKILL.md
     549 .claude/skills/measurement-rules/SKILL.md
```

That file is the copy a change is held to. **If the two ever disagree, the
skill wins and this section is stale** — regenerate rather than edit here.

What the tool is allowed to claim it measured, and how each figure is arrived
at. The rationale, with worked examples, is in
[docs/decisions.md](decisions.md) — this file is the rules a
change has to hold to.

Everything here sits inside **invariant 3**: git plumbing, hashes, regular
expressions over path strings, and multiplication by a number in a file. No
model is ever asked whether work shipped, what code is, or whether money was
well spent.

### Outcome

Rationale and examples: [Did it ship?](decisions.md#did-it-ship).

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

### Class

Rationale: [What will this one cost?](decisions.md#what-will-this-one-cost).

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

### Intent source

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

### Scan

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

### Debt

Rationale and a worked report:
[The files nobody plans for](decisions.md#the-files-nobody-plans-for).

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

### Co-change — removed, do not reintroduce

Full reasoning: [Rejected](decisions.md#cochange--the-files-that-move-together).

`session cochange` shipped and was cut before 1.0, with `src/cochange.ts`,
`partnersOf`, `MIN_TOGETHER` and `MIN_RATE`. It counted, per pair of paths, the
sessions that changed both over the sessions that changed the commoner of the
two.

**Why it went.** It read `reality` and nothing else, so no declaration entered
the arithmetic and nothing it printed could be a planning failure — what it
ranked was which files are central. `debt` reads `drift`, which is `reality`
less what was declared, and that subtraction is the whole difference between
the two reports. Its one consumer was `prime`, also rejected, after which
`partnersOf` had no caller but its own tests.

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

### Survival

Rationale and a worked report:
[Did it stick?](decisions.md#did-it-stick).

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
repo, from the `SessionEnd` hook and opportunistically from `week`, `show` and
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
the count prints and no rate does, exactly as in `estimate`. Declared and
captured are separate lines and never a total, and a block holding nothing
still prints, for the reasons under Estimate.

`SURVIVAL_BENCHMARK` is one constant, quoted from both ends: churn here is
exactly the share that did not survive, so 90% survival and 10% churn are the
same line. Two constants would be two things to keep in step. It is somebody
else's published figure, not a measurement — it is there so a reader has
something to sit their own figure against.

### Estimate

Rationale: [What will this one cost?](decisions.md#what-will-this-one-cost).

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

### Cost in money

Rationale and the file format:
[What it cost](decisions.md#what-it-cost) and
[Where the prices come from](decisions.md#where-the-prices-come-from).

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

### Which turns produced nothing

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

Views render the absence rather than a nought: an em dash in `week`'s column
and totals, a note under the table naming how many sessions could not be
counted, `not measured` in `show --full`'s `no edits` row, and one figure fewer
in the brief line and in the pull request body — the same rule as
[A total nobody can work out](#a-total-nobody-can-work-out).

### A category with no members

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

### A total nobody can work out

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
surface: an em dash in `week`, `not captured` in `--md`, no cost rows in `show`,
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
- `week` in the terminal puts `NO_PRICE` in the total row and omits the
  `… spent` line entirely, leaving the `N sessions unpriced: <models>` and
  `N sessions uncaptured: no turns on the record` lines to say why. A week that
  genuinely cost nothing totals `$0.00` there, like the rows above it. Every
  row carrying a dash is counted by one of those two notes: a cell that says
  nothing under a footer that counts nothing is a hole the reader can see and
  the table will not admit to.
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

## Shipped, and rejected

Shipped is the twenty verbs above. Rejected is kept in the repository rather
than dropped, because the measurement is the useful part: a reader deciding
whether to try one of these again starts from what already failed.

```console
$ awk '/^## Rejected/{on=1} on && /^### /{print}' docs/decisions.md
### `cochange` — the files that move together
### `prime` — a proposed scope from the repo's own history
```

**`cochange`** was built, shipped, and cut before 1.0. It counted, per pair of
paths, the sessions that changed both over the sessions that changed the
commoner of the two. It read `reality` alone, so no declaration entered the
arithmetic and nothing it printed could be a planning failure — what it ranked
was which files are central. `debt` reads `drift`, which is `reality` less what
was declared, and that subtraction was the only real difference between the two
reports. Its one consumer was `prime`; once `prime` went, `partnersOf` was
called by nothing but its own tests.

**`prime`** was to propose a scope at `session start` from the repo's own
co-change and drift history. It was measured against this repo's real log and
never shipped: exact-path hit rates of 6%, 18% and 12% across three sessions,
and the two rolled-up proposals that scored 100% did so by claiming 139 of 142
tracked files. A scope covering the repository cannot produce drift, because
there is nothing left outside it to drift onto.

Both entries carry their full reasoning in
[`docs/decisions.md`](decisions.md#rejected), and `prime`'s carries its backtest
table. Two sections of the record's design that were settled before `prime` was
measured are kept under `Superseded` banners rather than deleted, because an
append-only log cannot be backfilled and those questions had to be answered
while a session could still be opened under them.

`prime`'s backtest still runs, which is the point of keeping a rejection: the
script vendors the co-change functions that were deleted with the command, so
the measurement can be redone rather than only cited.

```console
$ node evidence/prime-backtest.mjs 2>&1 | grep 'exact paths'
  exact paths   covered 2/34 (6%)   claims 5/136 of the tree
  exact paths   covered 3/17 (18%)   claims 5/136 of the tree
  exact paths   covered 3/25 (12%)   claims 5/136 of the tree
```

The three exact-path figures are the honest column — 6%, 18% and 12%. The two
rolled-up proposals that read 100% did so by claiming almost the whole tree.
Note the tree denominator moves with the tree: `decisions.md` records 142
tracked files, measured before `cochange` was removed, and the same run now
divides by 136.

## Layout

Verbatim from `Claude.md`:

```
src/  cli.ts registration   commands/ start stop show week scan debt survival pr sweep
      verify key config settle estimate intent home hook   render/ palette.ts (semantic)
      terminal.ts html.ts markdown.ts pr.ts (a pull request body, from the record)
      capture/ hook.ts, adapters/claude-code.ts, transcript.ts
      (what a transcript line means — the adapter and scan.ts both read through it)
      store.ts JSONL   outcome.ts merged/abandoned/open   classify.ts path+intent rules
      empty.ts which turns produced nothing, settled against the diff at stop
      pricing.ts money   observe.ts repo facts   scan.ts aggregation   git.ts diff, HEAD
      scope.ts what a declared scope covers (stop and debt share the one rule)
      debt.ts paths that keep drifting and were never declared since, per repo
      survival.ts whether merged work is still there at 14 and 30 days
      commands/sweep.ts settle + due checks, once a day per repo, silent unless written
      chain.ts hashes  keys.ts Ed25519  verify.ts chain walk  sync.ts refs/session/*
      config.ts .session.json, checked in   ../rates.json prices per model, per Mtok
```

## Prices

```console
$ node -e "const r=require('./rates.json');console.log('model entries: '+Object.keys(r.models).length);console.log('prices checked: '+r.checked)"
model entries: 42
prices checked: 2026-08-23
```

Prices are data, not code: `rates.json` beside the package, merged entry by
entry with `~/.session/rates.json` if there is one. A model in neither is
reported unpriced, with its tokens and its name — never priced at the nearest
model's rate. A release of this tool is not a price update.

## Tests

```console
$ npm test 2>&1 | tail -5
 Test Files  38 passed (38)
      Tests  1421 passed (1421)
   Start at  14:39:13
   Duration  140.83s (transform 950ms, setup 0ms, collect 3.35s, tests 567.86s, environment 3ms, prepare 1.15s)
```

```console
$ npm run typecheck 2>&1 | tail -2
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
```

Typecheck covers `tsconfig.json` and `tsconfig.test.json` both; silence is a
pass.

## The other rule files

```console
$ ls .claude/skills
measurement-rules
sync-and-chain
terminal-output
```

Each covers one area and is loaded when that area is what is being changed:
`measurement-rules` (outcome, class, intent source, scan, debt, survival,
estimate, money), `sync-and-chain` (the line on disk, verify, refs),
`terminal-output` (CLI surface, colour, Markdown, the pull request body).

## Regenerating this file

This document is derived, not edited. Every console block above is the real
output of the command printed with it, and the prose blocks are copied out of
the files that own them.

```
node evidence/gen-context.mjs
```

`test/context.test.ts` fails when a copied block no longer matches its source,
which is the signal to run that again. The five sources, and the one extraction
rule both the generator and the test read them through:

```
Claude.md                                   invariants, layout
.claude/skills/measurement-rules/SKILL.md   measurement rules
src/store/record.ts                         interface Session
docs/decisions.md                           what 1.0 means, the rejected list
evidence/verbs.mjs                          the command surface
evidence/extracts.mjs                       how each block above is cut out
```
