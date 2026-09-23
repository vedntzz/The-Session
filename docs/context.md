# Context

What `session` is, as the repository actually stands.

Every figure below is followed by the command that produced it and that
command's real output. Nothing here is typed from memory and nothing is
summarised from a conversation: a number that has gone stale can be caught by
running the line printed above it.

Derived at `9889fff shell: refuse zsh expansions the tokenizer could not see` (`v1.0.0-45-g9889fff`).

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
  "version": "0.6.0",
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
@vedantzz/session@0.6.0 /Users/vedant/dev-session
├── commander@14.0.3
└── picocolors@1.1.1
```

Two runtime dependencies, Node 20 or newer, ESM. No build step beyond `tsc`, no
bundler, no monorepo.

```console
$ find src -name '*.ts' | wc -l && find src -name '*.ts' -exec cat {} + | wc -l
     130
   18030
```

```console
$ find test -name '*.ts' | wc -l && find test -name '*.ts' -exec cat {} + | wc -l
      61
   18853
```

The commands above count the source and tests currently in the checkout.
The intended practice is *prefer adding a test over adding a log line*, from
Style in `Claude.md`.

## The six invariants

Copied verbatim from `Claude.md`, which owns them — extracted with
`awk '/^## Invariants/,/^## Stack/' Claude.md`. Everything else in this
document is downstream of these.

1. **`intent` is immutable, and so are the accepted terms.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation. No `--edit-intent` flag, ever. The same holds for `agreement`, `proposal` and `checkout`: signed into the creating record, never patched, never added to a session that began without them, never backfilled onto an old one.
2. **Source code, prompts and transcripts never leave the machine.** Data lives in JSONL on the user's disk. `sync.ts` moves records over a git remote the team already has, by git talking to git — nothing this project runs is a service. The tool itself needs no account, reaches no network but that remote, and sends nothing. An [optional hosted team layer](docs/decisions.md#what-never-leaves-the-machine) may take metadata only — paths, counts, decisions, outcomes, costs — and does not exist yet, so anything in this repo reaching for one is wrong. Content never crosses, under any flag.
3. **Deterministic only.** File diffs, test exit codes, token counts from the transcript. No LLM is called to judge whether code is good, whether scope was met, or what a session "meant" — nor to write prose about any of it. `session pr` is the standing test of this: a pull request body is exactly where a generated paragraph would be most welcome and most expensive, so it is a transcription of the record and nothing else. A model may *propose* — a scope, an agreement — for the developer to accept, edit or reject before the work; the proposal records its proposer (`prime` or `external`; older proposals without the field read as `prime` through `proposerOf`, their bytes untouched) and is recorded apart from what was accepted, as Prime's is, and only what was accepted is ever measured against. This tool never calls a model. [Models propose, never judge](docs/decisions.md#the-v1-boundary).
4. **Turns that produced nothing are first-class.** Turns that changed no files are counted and displayed, never dropped — and where the record cannot say which turns those were, *that* is displayed rather than a nought. A transcript names the tool a call used, never what it did to the disk, so the question goes to git: `empty.ts` is the one rule, and no view reads `cost.emptyTurns` itself.
5. **Cross-tool.** Nothing may assume a specific coding tool. Adapters go behind an interface; the core reads a normalised shape.
6. **The write check never grants.** `session hook check` answers `ask` or `deny`, or prints nothing and leaves the editor's own permissions in charge — never `allow`, never the host's literal `defer`, never rewritten tool input. A failure it can catch is a denial, not a guess, and no response echoes source content, paths or a raw error. The payload never chooses the repository; the process cwd does.

## The surface

The v1 surface, after `estimate` was cut, `show` became `week <id>` and `debt` became `prime --debt`. Read from the real `commander` registration tree by
walking `buildProgram().commands` — not from `--help`, which is a filtered view
of it, and not from the Readme, which is prose.

```console
$ node evidence/verbs.mjs
top-level verbs:        20
including subcommands:  27

start [intent]            Begin a new session
                          --scope <paths...>  --review  --passive
prime [intent]            Suggest specific scope paths from previous planning misses, and show what keeps drifting
                          --seed <paths...>  --start  --review  --scope <paths...>  --debt
intent                    For the editor hook: record the first prompt as an undeclared session's intent
                          --from-prompt
stop                      End the active session
                          --if-open
week [id]                 Summarize recent sessions, or one session by its id
                          --days <n>  --client <name>  --project <name>  --outcome <state>  --class [name]  --intent <source>  --tokens  --full  --md  --copy  --open
ui                        Browse sessions in an interactive terminal interface
                          --days <n>
knowledge                 Explore recorded session relationships and export agent context
knowledge graph           Create an interactive local graph and compact JSON snapshot
                          --days <n>  --limit <n>  --path <prefix>  --session <id>  --out <file.html>  --no-open
knowledge context         Print compact, self-describing JSON for any agent to read
                          --days <n>  --limit <n>  --path <prefix>  --session <id>
pr [id]                   Write a pull request body from a session's record
                          --copy  --out <path>  --template <path>
scan                      What the agent sessions already on this machine have cost — no setup needed
                          --days <n>  --repo <path>  --open
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
hook check                Check a PreToolUse write against the open session's agreement
hook install              Register the Claude Code hooks that open and close sessions
                          --uninstall  --passive [yes|no]  --no-passive  --enforce
help [topic]              Every command, not just the ones above
```

The command above counts top-level verbs and subcommands. `session --help` deliberately lists only `start`,
`week`, `help all` and the bare screen — a decision about what a first reader
can use, not a claim about what exists. `session help all` lists every one, and
is built by walking this same tree, so a command renamed cannot fall off it.

The count is pinned by a test, not only by this document: `test/program.test.ts`
asserts the v1 command set against a sorted list of names.

### The v1 boundary

Verbatim from `docs/decisions.md`:

> **The freeze is retired, 21 September 2026.** It read: the surface is frozen
> at twenty verbs, refinement only, with named exceptions. It had three
> exceptions and a reopening by then, and a rule that is argued around every
> month is a rule that describes last month. What replaces it is a boundary
> on what the tool is for, and a smaller surface inside it. The old text is
> kept under [the freeze, as it was](#the-freeze-as-it-was).

**v1 is the record: what was declared, what changed, and what became of it.** Declare what the work is before an agent runs, record what it actually did, and hold the two against each other — deterministically, on the developer's disk. Anything that serves that loop is inside. Anything that measures something other than the distance between a declaration and a diff is outside, however useful, and the two cuts that taught this are in [Rejected](#rejected).

**Cut on the way in.** Three commands went in the same change, because each was a second door onto something another command already shows:

- **`estimate`** — sessions like this one, restated as a median. See [What will this one cost?](#what-will-this-one-cost).
- **`show`** — one session. It is now `session week <id>`, with `last` for the most recent closed one and `--full` and `--tokens` as before. The id a week row prints is the id it takes, so reading a row closer is the same verb as reading the rows.
- **`debt`** — the files nobody plans for. It is now part of `prime`: the owed files of this repo in the preview, and `session prime --debt` for the whole report. See [The files nobody plans for](#the-files-nobody-plans-for).

The short `--help` is unchanged: the bare screen, `start`, `week` and `help all`.

**Models may propose; they never judge.** [Invariant 3](../Claude.md) still holds in full: no model is asked whether code is good, whether scope was met, whether work shipped, or what a session meant, and no model writes prose about any of it. What it now permits is a *proposal* — a scope, an agreement, a list of sensitive paths — put in front of the developer to accept, edit or reject before the work starts. The line between the two is the one Prime already draws: a proposal is recorded whole and apart from what was accepted, it is labelled for what it is, it records its proposer — `prime` for Prime's rule, `external` for anything else that suggested it (written on every new proposal; older records without it read as prime, their bytes untouched) — and only what the developer accepted is ever measured against. A proposal that could clear drift, settle an outcome or colour a figure would be a judgement arriving by another door. This tool never calls a model.

### The freeze, as it was

> **Prime reopened, September 2026.** The user explicitly requested completing
> Prime after the freeze. The current [Prime workflow](prime.md) uses exact
> paths and comparable declarations' drift, retains an immutable proposal,
> and labels accepted sessions `primed`. The original rejected algorithm
> below remains historical evidence; co-change and roll-up remain removed.

**The surface is frozen at twenty verbs.** No new commands after 1.0 — refinement only: bugs, documentation, error messages, and making what is already there clearer.

Three exceptions, named here so that nothing else can be argued into the same shape later:

- **A GitHub Action that posts the record on a pull request.** `pr` already writes it; this puts it where the review happens.
- **A team view over the peer records `pull` already fetches.** They are on the machine and nothing reads them together.
- **`ui`, a browsable ledger over the same window `week` prints.** Added September 2026, the twenty-first verb.

None of the three is a new measurement. All are a surface onto what the tool already records.

**Why `ui` passes the same test as the other two.** It reads through `weekSessions`, so its rows are the rows `week` prints and its outcomes come through `withOutcomes` like everything else; it writes nothing, creates nothing, and asks the repository no question `week` does not already ask. Every figure on it comes from `pricing.ts`, `empty.ts` and `scope.ts` — there is no arithmetic in `render/tui/` that exists nowhere else. What it adds is reach: `week` fits a session to one row and a page to eighty columns, so the paths, the proposal and the observations behind a row have nowhere to go, and `week <id>` reaches them one session at a time. A timeline you can move through answers "which of these went wrong" without printing twenty sessions at full depth.

**What it cost to say yes.** A verb, and the admission that the freeze now has three exceptions rather than two — which is the shape the freeze was written to resist, and the reason this paragraph exists rather than a quiet edit to the list above. The line that has not moved is the one about measurement: a fourth exception that computes something is a different argument and does not get to cite this one.

The reason is that the surface outgrew the story once already, and not narrowly. `prime` was measured and never shipped; `cochange` shipped and was cut. The same fault both times: each measured something other than the distance between a declaration and a diff, and it took a backtest and a fold to see it.

A freeze written down is worth more than one I remember. The next good idea will arrive with a rationale, and the rationale is the part I am bad at refusing.

## The record

One JSON object per line, append-only, hash-chained and signed.

```console
$ grep -n 'SESSION_HOME' src/store/paths.ts
165:  return options.home ?? process.env["SESSION_HOME"] ?? path.join(homedir(), ".session");
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
  /** Canonical checkout root captured at creation; absent on older records. */
  checkout?: string;
  /** Accepted terms, written only in the creating record; absent before agreements. */
  agreement?: import("../agreement.js").Agreement;
  /** Prime's original suggestion, immutable and separate from accepted scope. */
  proposal?: import("../prime.js").PrimeProposal;
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
   * How the intent and scope were chosen. Absent on records before passive
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
     566 .claude/skills/measurement-rules/SKILL.md
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

There is no table over the words of an intent. `INTENT_RULES` read a class off
an intent for `estimate`, and went with it — see Estimate, below. Paths are the
only thing a class is read off.

### Intent source

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

### Prime

Current rule and workflow: [Prime](prime.md). The original
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

### Estimate — removed, do not reintroduce

Rationale: [What will this one cost?](decisions.md#what-will-this-one-cost)
and [the v1 boundary](decisions.md#the-v1-boundary).

`session estimate` restated past sessions of a class as a median, p90,
first-time merge rate and drift, one block per source. Cut on 21 September
2026 with `src/estimate/`, `render/estimate.ts`, `INTENT_RULES` and
`classifyIntent`. Every figure it printed is still on the record for `week`.
`MIN_SESSIONS` survives in `survival.ts`, where the survival rate uses it.

**The rule.** No view returns that projects a cost from past sessions, and
nothing reads a class off the words of an intent.

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

Views render the absence rather than a nought: `unknown` in `week`'s `no edits`
column, a note under the blocks naming how many sessions could not be counted,
`not measured` in `week <id> --full`'s `no edits` row, and one figure fewer
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

## Shipped, and rejected

The implemented surface is listed above. Rejected designs are kept in the repository rather
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

**The original `prime` rule** was to propose a scope at `session start` from the repo's own
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

The old backtest is retained and requires the original target sessions.
The current implementation uses exact files and comparable declarations'
drift, with no co-change or roll-up. It can abstain and records accepted
scopes separately from the original suggestion. See [Prime](prime.md) for
the workflow, limits, and current evaluation. Run
`node evidence/prime-evaluate.mjs` after building to evaluate the production
rule against the history on this machine.

## Layout

Verbatim from `Claude.md`:

```
src/  cli.ts registration   commands/ start prime stop show week scan debt survival pr sweep
      verify key config settle intent home hook   render/ palette.ts (semantic)
      terminal.ts html.ts markdown.ts pr.ts (a pull request body, from the record)
      capture/ hook.ts, adapters/claude-code.ts, transcript.ts
      (what a transcript line means — the adapter and scan.ts both read through it)
      store.ts JSONL   outcome.ts merged/abandoned/open   classify.ts path rules
      empty.ts which turns produced nothing, settled against the diff at stop
      pricing.ts money   observe.ts repo facts   scan.ts aggregation   git.ts diff, HEAD
      scope.ts what a declared scope covers (stop and debt share the one rule)
      prime.ts exact-file scope suggestions from past unaided declarations
      commands/prime.ts preview or start   program/prime.ts CLI registration
      render/prime.ts original proposal, support and tracked-tree coverage
      debt.ts paths that keep drifting and were never declared since, per repo
      survival.ts whether merged work is still there at 14 and 30 days
      commands/ui.ts terminal ownership, keys, refresh   program/ui.ts registration
      render/tui/ screen.ts frame, state.ts keys and filters, text.ts widths and
      safeText (record text is data, never a terminal command) — reads only
      commands/sweep.ts settle + due checks, once a day per repo, silent unless written
      chain.ts hashes  keys.ts Ed25519  verify.ts chain walk  sync.ts refs/session/*
      config.ts .session.json, checked in   ../rates.json prices per model, per Mtok
      store/ record.ts types, append.ts writer, read.ts fold, paths.ts store location
      agreement.ts accepted terms and validation — no tool names, no enforcement
      commands/review.ts the --review screen   render/agreement.ts every term, visible
      agreement-decision.ts pure defer/ask/deny for one attempted write
      capture/write-request.ts normalised write   adapters/claude-write.ts Edit/Write
      parser, keeps cwd and file path only   commands/resolve-write.ts read-only
      path resolution against a trusted root   write-session.ts the one open session
      bound to this checkout   commands/check-write.ts `session hook check`
      shell/ words.ts one simple command's words, or unknown
      package-manager.ts npm/pnpm/yarn → manifest and lockfile, or unknown
      sed.ts redirect.ts tee.ts → paths written; move.ts copy.ts remove.ts →
      requests, resolved read-only by commands/resolve-{move,copy,remove}.ts
      read-only.ts the short list of commands known to write no file
      commands/resolve-shell.ts one command → the writes to check, or unknown
../evidence/prime-evaluate.mjs production Prime rule, walk-forward evaluation
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
$ npm test -- --exclude test/context.test.ts 2>&1 | tail -5
 Test Files  60 passed (60)
      Tests  2141 passed (2141)
   Start at  10:20:13
   Duration  221.99s (transform 1.76s, setup 0ms, collect 8.02s, tests 1056.07s, environment 7ms, prepare 3.24s)
```

The generator runs the behavioral suite before writing this document, then
checks `test/context.test.ts` against the newly written text. It excludes that
self-check from the earlier run to avoid testing the stale document it is
replacing.

```console
$ npm run typecheck 2>&1 | tail -2
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
```

Typecheck covers `tsconfig.json` and `tsconfig.test.json` both; silence is a
pass.

## The other rule files

```console
$ ls .claude/skills
agreements-and-enforcement
measurement-rules
sync-and-chain
terminal-output
```

Each covers one area and is loaded when that area is what is being changed:
`measurement-rules` (outcome, class, intent source, scan, debt, survival,
Prime, money), `sync-and-chain` (the line on disk, verify, refs),
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
docs/decisions.md                           the v1 boundary, the rejected list
evidence/verbs.mjs                          the command surface
evidence/extracts.mjs                       how each block above is cut out
```
