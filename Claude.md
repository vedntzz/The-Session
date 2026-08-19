# CLAUDE.md

## What this is

`session` — a CLI that records AI coding sessions. The developer declares intent before an agent runs; the tool records what actually happened. The gap between the two is the product.

## Invariants — do not violate these

1. **`intent` is immutable.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation, not a declaration. No `--edit-intent` flag, ever.
2. **No server, no database, no account.** Data lives in JSONL on the user's
   disk. Nothing this project runs is ever reachable over a network, and there
   is nothing to sign up for.
   (This replaces a flat "if a change requires network access, it's wrong". The
   ban held until records had to reach a teammate. `sync.ts` sends them over a
   git remote the team already has, only when somebody types `push` or `pull`,
   and every byte moves by git talking to git. No service of ours is involved,
   which is what the invariant was protecting. Anything that would need one is
   still wrong.)
3. **Deterministic only.** File diffs, test exit codes, token counts from the transcript. No LLM is called to judge whether code is good, whether scope was met, or what a session "meant".
4. **Turns that produced nothing are first-class.** Turns and API calls that changed no files are counted and displayed, never dropped.
5. **Cross-tool.** Nothing may assume Claude Code specifically. Adapters go behind an interface; the core reads a normalised shape.

## Stack

- Node 20+, TypeScript, ESM
- `commander` for the CLI, `picocolors` for output
- Storage: `~/.session/<repo-hash>.jsonl`, one JSON object per line, append-only
- No build step beyond `tsc`. No bundler, no monorepo, no Bun.

## Layout

```
src/
  cli.ts           command registration
  commands/        start.ts stop.ts show.ts week.ts verify.ts key.ts config.ts
                   settle.ts estimate.ts intent.ts home.ts
  capture/         hook.ts, adapters/claude-code.ts
  store.ts         JSONL read/append
  config.ts        .session.json at the repo root — attribution, checked in
  outcome.ts       merged/abandoned/open from repo facts, pure
  classify.ts      two rule tables — one over paths, one over intent text, pure
  observe.ts       gathers those facts and applies them to sessions
  pricing.ts       tokens to dollars; loads rates.json, pure above that
rates.json         bundled prices, per model, per million tokens
  chain.ts         canonical JSON, record and line hashes
  keys.ts          Ed25519 keypair at ~/.session/keys/, sign and verify
  verify.ts        the chain walk, pure
  git.ts           HEAD, diff, changed files
  sync.ts          records over refs/session/*, push/pull/peers
  render/          palette.ts (semantic colour), terminal.ts, html.ts
                   terminal.ts holds both shapes: the brief views `show` and
                   the bare screen print, and the labelled layout behind --full
```

## The record

```ts
type Session = {
  id: string
  repo: string
  intent: string          // immutable
  intentSource?: IntentSource  // 'declared' | 'captured' — where the words came
                          // from. Fixed when the session opens; absent on
                          // records written before passive capture, where it
                          // reads as declared.
  scope: string[]         // declared, may be empty
  baseline: string[]      // already dirty at start, subtracted from reality
  reality: string[]       // observed from git diff, less baseline
  drift: string[]         // reality minus scope
  class?: SessionClass    // what it was mostly working on, from the path rules
                          // in classify.ts. Written at stop; absent on older
                          // records, where readers derive it from reality.
  cost: SessionCost
  outcome: 'open' | 'merged' | 'abandoned' | 'empty'
  startedAt: string
  endedAt: string | null
  startCommit: string
  attribution?: Attribution   // client/project/sow/billingCode, copied from
                              // .session.json at start. A copy, not a
                              // reference, and not patchable — who was billed
                              // is decided before the work, like intent.
  endState?: Record<string, string | null>
                              // blob id of each reality path as the session
                              // left it, captured at stop; null = deleted.
                              // A fact, like reality. Without it there is
                              // nothing to go looking for later.
  observations?: Observation[]  // where it was seen to end up. Never the
                              // basis for display — see below.
}

type Observation = {
  outcome: SessionOutcome
  observedAt: string          // when it was looked at
  commit: string              // the default branch's tip that day
  branch: string              // what it was judged against
  source: 'computed' | 'manual'
}

type TokenCounts = {
  // Four counters, never one sum: each bills at a different rate, so a total
  // cannot be converted back into money.
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number
}

type SessionCost = TokenCounts & {
  // Turns are prompts; calls are what each prompt set off. Both are kept:
  // turns are the honest unit for "how much of this produced nothing",
  // calls are what the transcript measures directly.
  turns: number
  emptyTurns: number             // turns that wrote no files
  apiCalls: number               // streaming fragments collapsed by requestId
  callsWithoutEdits: number

  model: string                  // the model that did the most calls

  emptyTurnTokens?: TokenCounts  // the same four counters, restricted to the
                                 // turns that wrote no files. Counted at
                                 // capture, where which turn a call belonged
                                 // to is still known. Absent on sessions
                                 // captured before it existed; nothing infers
                                 // it. See below.
}
```

## Outcome

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

Note this stays inside invariant 3: it is all git plumbing and hashes. No
model is asked whether the work "really" shipped.

## Class

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

Inside invariant 3: regular expressions over path strings. Nothing is asked what
the code does.

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

## Estimate

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

`pricing.ts` is the only file that knows a price. Everything above `loadRates`
is pure: `priceTokens`, `rateFor`, `priceSession`, `spendOf`, `formatUsd`.

Prices are **data**, not code — `rates.json` beside the package, merged entry by
entry with `~/.session/rates.json` if there is one. A model in neither is
reported unpriced, with its tokens and its name. Never price an unknown model at
the nearest model's rate: the figure goes on invoices, and an admitted gap beats
a plausible wrong number. Match exactly, or by the longest key that is a prefix
**at a dash** — transcripts report dated ids, and without the dash
`claude-opus-4` would price `claude-opus-45`.

`emptyTurnTokens` is measured, not apportioned. The adapter knows which turn
each call belonged to, so it adds the empty turns' tokens up directly; taking
the session total times `emptyTurns / turns` would look like a measurement and
would not be one. Empty turns are not average turns — the expensive one is the
whole point. Don't "simplify" this into a ratio, and don't backfill it onto
records that predate it.

Note this stays inside invariant 3 too: it is multiplication by a number in a
file. Nothing is asked to judge whether the money was well spent.

## The line on disk

A session is folded from patch records. Each record is one line, and every line
carries its own tamper-evidence:

```ts
type LogRecord = {
  v: number
  id: string
  at: string
  set: Partial<Session>
  prev: string            // SHA-256 of the whole previous line, GENESIS for the first
  key: string             // fingerprint of the signing key — which key to ask for
  hash: string            // SHA-256 of canonical({v,id,at,set,prev,key})
  sig: string             // base64 Ed25519 over the bytes of hash
}
```

Records written before this existed carry none of these. They are hashed into
the chain by the first signed record after them, counted as `unsigned`, and
never reported as damage. Records signed before `key` was added omit it, and
`canonicalJson` drops undefined, so they still hash exactly as they did — do
not "fix" that by defaulting `key` to a string.

`key` is a claim, not a proof: it says which key the log wants to be checked
against, which is what a holder of the log alone needs. It catches a log that
disagrees with itself about its key, and a log that disagrees with a key the
verifier already had. It cannot catch a wholesale rewrite under a new key.

`prev` makes the append a read-then-write, so appends take a lock file
(`<log>.lock`, created `wx`, stale after 10s). Reading is untouched:
`readSessions` folds records exactly as before and checks nothing — `session
verify` is the only thing that walks the chain.

`session verify --log <path> --key <pubkey>` must keep working on a machine
with no `~/.session` at all: with `--log`, nothing derives a store path, and
this machine's own key is never reached for. Checking a stranger's log against
your own key would report a mismatch that means nothing.

A log with no records in it reports `no records` and exits non-zero. Nothing
about it contradicts itself, so `isIntact` is true and stays true — that is
what it means — but `verify` is an evidence tool, and answering "verified" to
a file it read nothing out of is a vacuous pass, which is a defect. `isEmpty`
is kept separate from `isIntact` for exactly this reason; don't collapse them,
and don't make an empty log a chain break either, since nothing is broken.
The same rule covers `--peers`: a chain with no records fails, and so does
finding no chains at all.

`session verify --peers` walks every chain under `refs/session/*` and reports
each key on its own row. Not summed: each chain is one key's statement about
its own work, so "4 of 5 keys check out" is not a fact about anything, and a
break in one says nothing about the others. A key is only ever used on the
chain that claims it — this machine's key on this machine's ref, a `--key` on
the ref whose fingerprint matches — for the same reason a foreign log is never
checked against the local key. Everything else gets hashes only, and the row
says so rather than implying its signatures were checked. A plain `verify`
walks one log, so where other chains are present it says they went unchecked;
one log verifying is not everything here verifying.

## Sync

Records travel on `refs/session/<fingerprint>`, one ref per signing key. That is
the whole conflict story: only the machine holding a key writes that key's ref,
so two developers cannot write the same one and there is nothing to merge.

The log is a blob in a tree under a commit whose parent is the previous push, so
the ref carries the history of what was published and when. A rewrite is a tip
that does not descend from the old one — visible in `git log <ref>`, not silent.
A push whose log is byte-identical to the tip makes no commit; an empty commit
per push would fill that history with pushes that published nothing.

`pull` fetches every key's ref and stops. It never merges them into the local
log and never writes to it: a chain is one key's statement about its own work,
and folding two together would produce a file no key could stand behind. Peers
are read-only, and this machine appends to exactly one log — its own.

`push` verifies before it publishes and refuses a broken chain. Publishing a log
that does not add up would put this machine's name on it. `peers` checks each
peer's hashes on the way past — their signatures cannot be checked, since their
key is not here — and names any log that contradicts itself.

`(this machine)` is decided against the keypair in `~/.session/keys` and
nothing else: a ref name is a claim by whoever pushed it, and records that look
like ours are still not ours. The key is read, never generated — being asked
who else is out there is not a reason to start signing on a machine that never
has — so where there is no key here, nothing is labelled ours, which is true:
nothing on that machine could have written a chain.

Nothing lands under `refs/heads`, `refs/remotes` or `refs/tags`, so `git log`,
`git status` and `git branch -a` are untouched. `git log --all` does show these
refs, the same way it shows `refs/notes` and `refs/stash`: it means every ref,
and nothing can be both pushable and invisible to that.

All git plumbing sits below one line in `sync.ts` — hash-object, mktree,
commit-tree, update-ref, push, fetch, for-each-ref, cat-file — and everything
above it is pure. No porcelain, no index, no work tree.

## The CLI surface

Written for somebody who has just watched an agent run for forty minutes. That
reader can hold about three facts, and every extra one pushes out a fact they
needed.

`session --help` lists four entry points: the bare screen, `start`, `week`, and
`help all`. The other twelve commands are not hidden from the parser — they all
run, and `session help all` lists every one of them with its description. The
short list is a decision about what a first reader can use, not a claim about
what exists. `BRIEF_COMMANDS` in `program.ts` is the whole of it, and the list
is filtered out of the real command tree rather than written beside it, so a
command renamed cannot silently fall off.

`session help all` is built by walking `program.commands`, parents and
children. A hand-kept list would be one release away from being wrong, and this
is the one place that must not be.

`session` with no arguments is a **state screen, not a menu**: one sentence
about where the repo stands, then at most two commands. Which two depends on
the state, because in each state there is one obvious next move and at most one
other worth knowing. Commander would print the help here — the right answer to
"what is this" and the wrong one to "where am I".

`session show` is two sentences and a line of three figures: what was asked
for, what went outside what was declared, and cost / turns / turns that
produced nothing. The labelled layout is `--full`, and `--tokens` implies it
rather than being quietly ignored.

Nothing in the brief views is computed differently. They read the same
`intent`, `scope`, `drift` and `cost` the full view reads; what changed is how
much is said at once. Two consequences worth keeping:

- The drift **count** in the sentence is always exact; the **list** stops at
  three and counts the rest. A sentence naming twelve paths is one nobody
  finishes, and the number in front of it is what decides whether to run
  `--full`.
- The four cases of the second sentence are ordered by which fact the reader
  most needs: something went outside, here it is; nothing changed at all;
  nothing was declared, so the question cannot be asked; everything stayed
  inside. Note "changed nothing" comes before "declared nothing" — a session
  that changed nothing had nothing to go outside a scope, and sending that
  reader to `--scope` answers a question they do not have.

The brief views add **no colour roles**. The intent is `intent`, the drift
paths are `drift`, the framing is `meta`, and the money is left in the
terminal's own colour — the same roles doing the same jobs as in the layout
below. A view that needed a new role would be a view saying something the tool
does not otherwise say.

## Colour

`render/palette.ts` is the only file that knows an escape code, and the only
one that imports picocolors. Roles are named for what a thing *is* — `intent`,
`drift`, `waste`, `path`, `meta`, `merged`, `abandoned` — never for the ink
they get, so what the tool emphasises can be read off one file. `path` and
`meta` are both dim and are still two roles: the day one of them stops being
dim is a line here, not an audit of the layout code.

Only the 16 basic ANSI colours, and mostly attributes (bold, dim,
strikethrough). No 256-colour, no truecolor, no hex. The hues belong to
whoever configured the terminal — their red is legible on their background
because they picked it, and a hard-coded one is a guess about a background
this tool cannot see.

Red means *there is something here*: drift paths, and the waste figure only
when it is not zero. `$0.00` in red would teach the reader to ignore red, and
then the session that wasted $40 would go unread too. The cost figure itself
is never coloured — it is always there, and colouring what is always there
says nothing.

`colorEnabled` decides: `FORCE_COLOR` outranks everything either way, then
`NO_COLOR` (non-empty), then whether stdout is a TTY. Note this deliberately
differs from picocolors' own rule, which turns colour *on* under `CI` and on
Windows regardless of the stream — a CI log is a file somebody reads later.

The colourless render is the contract. It is what goes into pipes, files, CI
logs and bug reports, and `test/palette.test.ts` pins it byte for byte against
literals, plus asserts that stripping the codes out of the coloured render
gives back exactly the same bytes. Colour is an addition to a terminal, never
a change to the output. `plainPalette` is the same construction as
`ansiPalette` with the ink switched off, not a second hand-written table —
built the other way the two could come to disagree about what a role wraps.

## Style

- Small pure functions. Side effects only in `commands/` and `store.ts`.
- Errors state what happened and what to do: `No scope set. Run session start before your agent.`
- No emoji in CLI output. No spinners. No "Oops!". Colour only through
  `render/palette.ts`, and only ever as an addition to output that reads
  correctly without it — `!` still marks drift where colour cannot.
- Never anthropomorphise the agent — it ran, it changed files, it cost money.
- Prefer adding a test over adding a log line.

## Don't

- Don't let `session config` grow past attribution. It exists for one reason:
  who the work was for is a fact about the repo and the team, so it lives in a
  checked-in `.session.json` where everyone spells the client the same way.
  (This replaces a flat "no config files in v1"; the ban held until attribution
  needed a home that a team could share.)
- Don't let `~/.session/rates.json` become a settings file. It holds prices and
  nothing else: what a model costs is a fact about a bill, and the bundled
  numbers go stale the moment a vendor moves them, so somebody has to be able to
  correct them without waiting for a release. Anything about how *you* like the
  tool to behave is not this and still belongs nowhere. There is no user-level
  config, no `--format`, no default flags file.
- Don't build a spec language. Scope is a list of path prefixes, matched at directory boundaries.
- Don't add telemetry of any kind.
- Don't add a knowledge graph or a web server. Those are week-two questions.
- No hosted dashboard, no web server, no service to log into. A generated file
  the user opens or sends is not that — `week --open` and `report` write HTML to
  disk and nothing serves it.