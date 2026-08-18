# CLAUDE.md

## What this is

`session` — a CLI that records AI coding sessions. The developer declares intent before an agent runs; the tool records what actually happened. The gap between the two is the product.

## Invariants — do not violate these

1. **`intent` is immutable.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation, not a declaration. No `--edit-intent` flag, ever.
2. **No server, no database, no account.** Data lives in JSONL on the user's disk. If a change requires network access, it's wrong.
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
                   settle.ts estimate.ts
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
  render/          terminal.ts, html.ts
```

## The record

```ts
type Session = {
  id: string
  repo: string
  intent: string          // immutable
  scope: string[]         // declared, may be empty
  baseline: string[]      // already dirty at start, subtracted from reality
  reality: string[]       // observed from git diff, less baseline
  drift: string[]         // reality minus scope
  class?: SessionClass    // what it was mostly working on, from the path rules
                          // in classify.ts. Written at stop; absent on older
                          // records, where readers derive it from reality.
  cost: SessionCost
  outcome: 'open' | 'merged' | 'abandoned'
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

The percentile is nearest-rank: p90 is an amount some session was actually
billed, not one interpolated between two of them. "First time" means the first
terminal observation on the record, or the outcome computed now for a session
nobody has settled — a session abandoned and revived a month later merged, but
it did not merge the first time.

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

## Style

- Small pure functions. Side effects only in `commands/` and `store.ts`.
- Errors state what happened and what to do: `No scope set. Run session start before your agent.`
- No emoji in CLI output. No spinners. No "Oops!".
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
- Don't add a knowledge graph, a web server, or a dashboard. Those are week-two questions.