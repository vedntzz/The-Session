# Study sheet: twelve systems concepts, one small codebase

This sheet teaches computer science, system design and AI-engineering concepts you will be asked about in interviews. The worked example throughout is The Session, a CLI that records AI coding sessions. You don't need to care about the tool. It's here because it's small enough to read in an afternoon and it runs into each of these problems for real.

Each topic has four parts:

- **The problem**: what breaks without the idea.
- **The analogy**: one plain-English picture.
- **What's actually happening**: how it works, with real code.
- **SAY THIS**: a sentence or two you can say out loud in an interview.

Three drill questions follow each topic. At the end you'll find all twelve SAY THIS lines in one place and four prove-it tasks, which ask you to write code rather than read it.

References are `path:line` against the working tree as of 2026-09-15. Lines move over time. If a line number is off, search for the function name given next to it. Where the repo has no example of a concept, the sheet says so and teaches the concept anyway.

## Contents

1. [Append-only logs and event sourcing](#1-append-only-logs-and-event-sourcing)
2. [Hash chains and tamper evidence](#2-hash-chains-and-tamper-evidence)
3. [Public-key signatures (Ed25519), and what a signature proves](#3-public-key-signatures-ed25519-and-what-a-signature-proves)
4. [Content addressing](#4-content-addressing)
5. [Idempotence and deduplication](#5-idempotence-and-deduplication)
6. [Why aggregates lie](#6-why-aggregates-lie)
7. [Absence vs zero](#7-absence-vs-zero)
8. [Functional core, imperative shell](#8-functional-core-imperative-shell)
9. [Exhaustiveness and illegal states](#9-exhaustiveness-and-illegal-states)
10. [Falsifiable tests, and what underpowered means](#10-falsifiable-tests-and-what-underpowered-means)
11. [Survival analysis and censored data](#11-survival-analysis-and-censored-data)
12. [Local-first architecture](#12-local-first-architecture)
13. [The twelve SAY THIS lines](#the-twelve-say-this-lines)
14. [Prove it](#prove-it)

---

## 1. Append-only logs and event sourcing

**The problem.** Suppose you store only current state and update it in place. Every write destroys the old answer. You can't ask what the data said on Tuesday. A crash in the middle of a write can leave a record half-updated. Anyone who can write can also change history without leaving a trace. The Session's whole claim is "this is what you said *before* the work." If records can be overwritten, a declaration looks exactly like an edit made afterwards.

**The analogy.** A bank passbook. The teller never rubs out a line. A correction is a new line, and your balance is what you get by adding up every line.

**What's actually happening.** Each line of the log is a *patch*, not a snapshot: `{id, at, set}`, where `set` holds only the fields that changed (`LogRecord`, `src/store/record.ts:341-363`). `writeRecord` appends one line and never seeks backwards (`src/store/append.ts:97-120`). Current state is never stored. It is derived: `foldLogs` replays every line in order, and `foldRecord` lays each patch over what came before it (`src/store/read.ts:276-319`). That is event sourcing: *state = fold(events)*.

The design shows up three ways in the code:

- **A crash can only damage the last line.** The reader forgives exactly that case. A bad line anywhere else is an error (`read.ts:286-288`).
- **Appends still need a lock.** One `O_APPEND` write is atomic. A *chained* append is not: it reads the last line, then writes. Two writers doing that at once would fork the chain (`withLock`, `append.ts:36-54`).
- **Rules can be enforced when reading.** `keptIntent` keeps the first intent no matter what later lines say. Even a line appended by hand can't rewrite it (`read.ts:340-362`).

**Not in this repo: snapshots.** Every read replays the whole log. That's fine for thousands of lines. At billions of lines, production event stores save a snapshot and replay only what came after it. Kafka does this with log compaction.

**SAY THIS.** "I store events, not state. Every change is an appended patch, and current state is a fold over the log. That gives me history and crash safety, and it gives me a place to enforce write-once rules that a hand-edited file can't get around."

**Drills**

1. `foldRecord` spreads `record.set` over the existing session. What's the difference between a patch that omits a field and one that sets it to `undefined`? Why does it matter that `canonicalJson` drops `undefined` (`src/chain.ts:52-53`)?
2. Why isn't a single `O_APPEND` write enough here? Write out the interleaving of two processes that `withLock` prevents.
3. The reader forgives a malformed *last* line but throws on a malformed middle line. Argue that these are two different failures, not one failure in two places.

---

## 2. Hash chains and tamper evidence

**The problem.** An append-only file is only append-only by convention. Anyone with a text editor can change line 12. You want edits to be *detectable* without having to trust the disk, the filesystem or whoever had access.

**The analogy.** A row of wax seals, where each seal also carries an imprint of the seal before it. Break or replace one, and every seal after it shows the wrong imprint.

**What's actually happening.** Each line carries two hashes (`src/chain.ts:3-20`):

- `prev`: the SHA-256 of the previous line's exact bytes on disk. The first line uses `GENESIS`, 64 zeros (`chain.ts:23`), and `nextPrev` reads `prev` off the last line (`src/store/append.ts:92-95`).
- `hash`: the SHA-256 of this record's own body.

The body is hashed through `canonicalJson`, which sorts object keys recursively (`chain.ts:43-57`). A hash over raw JSON text breaks the moment a tool re-serializes with keys in another order, even though the record means the same thing. Canonical form makes the hash about the *value*. Note the split: `prev` hashes bytes, `hash` hashes values.

Checking is a walk from front to back. `checkChain` stops at the first fault (`src/verify.ts:99-123`), and the checks run in a fixed order: link, signed, body, key, signature (`verify.ts:164-177`). So the first failure reported is the line that was edited, not the broken links after it. Records written before signing existed are linked into the chain rather than rejected (`verify.ts:244-265`). The log was migrated without rewriting any history.

**The limit is stated in the file header: truncation** (`chain.ts:14-17`). Cut off the last ten lines and what's left is a shorter chain that still checks out. Catching that takes a *witness*: someone else who holds the latest head hash. Certificate Transparency does this with Merkle trees and auditors who gossip head hashes. This repo has no witness.

Tamper-*evident* is not tamper-*proof*. Nothing stops an edit. The chain only stops an edit from going unnoticed.

**SAY THIS.** "Each record commits to the hash of the one before it, so changing or deleting a record breaks every link after it. It's tamper-evident, not tamper-proof, and a single chain can't detect a cut-off tail unless someone outside holds the latest head."

**Drills**

1. Why does `prev` hash the raw line while `hash` hashes canonical JSON? What breaks if both use raw text? What breaks if both use canonical JSON?
2. An attacker edits line 12, then recomputes every `hash` and `prev` from line 12 to the end. The chain checks out. What stops them? (Your answer should lead to topic 3.)
3. Design the smallest addition that would detect truncation. What does it need that the tool deliberately doesn't have?

---

## 3. Public-key signatures (Ed25519), and what a signature proves

**The problem.** A hash chain is public arithmetic. Anyone can rewrite a record and recompute every hash after it. You need something only one party can *produce* but anyone can *check*.

**The analogy.** A signet ring. Anyone who has seen its pattern can recognise the seal, but only whoever holds the ring can make one. Lose the ring, and whoever finds it can seal anything.

**What's actually happening.** Ed25519 is an elliptic-curve signature scheme. Public keys are 32 bytes and signatures are 64. It is *deterministic*: the per-signature nonce is derived from the key and the message, not from a random number generator. That removes a whole class of bug. Sony's PS3 signing key was recovered from ECDSA signatures that reused a nonce.

In the code:

- **Key creation.** A key is generated on the first write (`src/keys.ts:124-140`). The private key file is created with `wx` and mode `0600`, so two processes racing to create it can't overwrite each other. The loser reads the winner's key (`keys.ts:142-164`).
- **Signing.** `signRecord` builds the body, hashes it, and signs the 32 raw hash bytes (`src/store/append.ts:122-139`, `signHash` at `keys.ts:249-252`).
- **Checking.** `verifyHash` returns false and never throws (`keys.ts:254-261`).
- **Fingerprints.** The key's fingerprint is embedded *inside* the hashed body, so a record can't be relabelled with another key (`src/chain.ts:70-79`). But the fingerprint is a claim, not a proof (`src/verify.ts:46-55`). Someone who rewrites the whole log with their own key gets a log that checks out completely. Tying a key to a person needs a separate channel: you read me your fingerprint in person, or a certificate authority vouches for it.

**What a signature proves:** whoever held this private key signed exactly these bytes. **What it does not prove:**

- when the signing happened (`at` is whatever the signer wrote)
- which human did it
- that the content is true
- that the key wasn't stolen
- that nothing signed was later deleted

The header says it directly: "tamper-evidence, not access control" (`keys.ts:21-23`).

Two small guards are worth copying. Passing a fingerprint where a key is needed is refused (`keys.ts:218-224`). Passing a *private* key where a public one is needed is refused with a warning (`keys.ts:233-247`).

**SAY THIS.** "A signature proves that whoever holds a specific private key signed specific bytes. It says nothing about time, truth or which human. Binding a key to a person is a separate, out-of-band problem, which is why a fingerprint inside a log is a claim, not a proof."

**Drills**

1. Why does ECDSA need a fresh random nonce for every signature when Ed25519 doesn't? What failure does that remove?
2. `session verify --log theirs.jsonl` with no `--key` can still report "intact". What exactly was checked, and what wasn't?
3. A teammate's laptop is stolen. What can the thief do with `~/.session/keys/ed25519.key`? What would the team need that this repo doesn't have?

---

## 4. Content addressing

**The problem.** If you identify things by *name* or *location*, the identity breaks when they move. Take the question "did this branch merge?" `git branch --contains <commit>` asks about commits. A squash merge writes a brand-new commit and keeps none of the originals, so asking by commit reports merged work as abandoned (`src/outcome.ts:3-16`).

**The analogy.** Identify a book by a fingerprint of its exact text, not by the shelf it's on. Move it, rebind it or take it to another library, and the fingerprint doesn't change.

**What's actually happening.** Git names every file's content by a hash: a blob id is SHA-1 of `"blob <size>\0"` followed by the bytes. The same bytes get the same id in every commit, branch and clone.

1. **At `stop`**, the tool records the blob id of each changed path (`endStateOf`, `src/git/blobs.ts:145-156`, called from `src/commands/stop.ts:128`). The ids come from `git hash-object`, so the same content filters apply as for committed blobs (`blobs.ts:74-80`).
2. **Later**, `historyOf` collects every blob that path has held on the default branch (`blobs.ts:34-53`). It uses `cat-file --batch-check`, which answers a missing path with `missing` instead of failing (`blobs.ts:9-32`).
3. **The merge test** is then one set lookup (`hasLanded`, `src/outcome.ts:129-134`).

Squash, rebase and cherry-pick all rewrite commits, and none of them changes the bytes, so all three are detected. `classify` then sorts the files into landed, in flight and lost, and picks an outcome (`outcome.ts:171-195`).

**Limits, all real:**

- A reviewer who edits a file before merging changes its blob, so that path won't count as landed.
- Renames aren't followed (`blobs.ts:36-37`).
- A deletion has no blob. It counts as landed when the path is gone at the tip, which can't tell whose deletion it was (`outcome.ts:121-128`).

Content addressing also makes some operations idempotent for free: `publishLocally` compares tree ids and skips the commit when the bytes haven't changed (`src/sync/publish.ts:107-124`). The same idea appears in Docker image digests, IPFS, Nix store paths and build caches.

**SAY THIS.** "Git identifies content by its hash, so identical bytes have the same identity whichever commit carries them. A squash merge throws away commits but not bytes, so to detect a merge I record the blob ids a session left and look for them in the default branch's history."

**Drills**

1. A session changes three files. A reviewer reformats one of them before squash-merging. What does `classify` return, and is that the right answer?
2. Why does `workingBlobs` shell out to `git hash-object` instead of hashing the file with Node's `crypto`?
3. A session leaves a file byte-identical to a version that was on main two years ago. What does the tool conclude? How likely is that in practice, and for which kinds of file?

---

## 5. Idempotence and deduplication

**The problem.** Networks, retries and streaming deliver the same thing more than once, and anything that adds per delivery over-counts. Here's the concrete case. A Claude Code transcript writes one API call as several streaming fragments, each with the same `requestId` and the same usage block. Sum per line and the bill gets multiplied by however many pieces the network happened to split the call into (`src/capture/transcript.ts:163-171`).

**The analogy.** A lift button. Press it five times and one lift comes. The press is idempotent. A counter of "people waiting" must not go up once per press.

**What's actually happening.** Two related ideas:

- **Idempotence** means doing something again changes nothing: *f(f(x)) = f(x)*.
- **Deduplication** gives each delivery an identity key, so the *effect* happens once even when delivery is at-least-once.

`recordCall` keeps a `Map<requestId, Call>`. The first fragment is recorded and later ones return early (`transcript.ts:172-192`). That's an idempotency key, the same idea as an `Idempotency-Key` header on a payments API. Note the assumption underneath it: fragments carry *identical* usage (`transcript.ts:20-24`). If a format ever sent running totals, keeping the first fragment would under-count. The key would still be right, but the merge rule would be wrong.

Idempotent operations elsewhere in the repo:

- **`settle`** writes an observation only when the last one says something different (`alreadySaid`, `src/commands/settle.ts:75-78`, used at `179-195`). Run it twice with nothing changed and it writes nothing. If the branch has moved, it appends a *second* observation rather than editing the first.
- **`publishLocally`** makes no commit when the tree id is unchanged (`src/sync/publish.ts:117-120`).
- **The daily sweep** writes its stamp *before* doing the work (`src/commands/sweep.ts:133-134`). That makes it at-most-once per day. It accepts a missed sweep so that a sweep which keeps getting killed never re-runs on every command.

**SAY THIS.** "At-least-once delivery plus an idempotency key gives you effectively-once effects. For transcripts the key is the requestId: streaming repeats a call's usage across fragments, so I count each requestId once instead of summing lines."

**Drills**

1. Is `session settle` idempotent? State it precisely, including what happens when the default branch moves between two runs.
2. The sweep stamps before doing its work. What failure does that choose, and what's the failure of stamping afterwards? When would you choose the other one?
3. A new tool's transcripts send *cumulative* usage per fragment, possibly out of order. Rewrite the merge rule in one sentence. Is your rule independent of arrival order?

---

## 6. Why aggregates lie

**The problem.** "Tokens used" looks like a measure of cost, and it isn't. Tokens come in four kinds that bill at different rates. Adding them together throws away the information you'd need to turn the total back into money, so two sessions with the same total can differ in cost by 50×.

**The analogy.** A shopping basket described as "12 items". Twelve apples and twelve bottles of champagne are both 12 items.

**What's actually happening.** `TokenCounts` keeps four separate counters: fresh input, cache read (discounted), cache creation (charged at a premium) and output (`src/store/record.ts:6-19`). Everything that combines costs adds them field by field (`addTokens`, `src/capture/adapter.ts:57-69`). A `totalTokens` function exists, and its comment says "for display only — never for pricing" (`record.ts:89-94`). Pricing multiplies each counter by its own rate (`priceTokens`, `src/pricing.ts:36-45`).

**A worked example.** Take the sample rates in the error message at `pricing.ts:449-450`, per million tokens: input $5, cache read $0.50, cache creation $6.25, output $25.

- A million cache-read tokens cost $0.50.
- A million output tokens cost $25.

The totals are identical and the costs differ by 50×. In long agent sessions, cached input is most of the traffic (`transcript.ts:42-46`), so token totals make cheap work look far bigger than it is.

The code refuses two more aggregation traps:

- **Apportionment.** You might estimate what empty turns cost as *total × (empty turns ÷ turns)*. The code refuses, because "empty turns are not average turns" (`record.ts:51-63`). A share of *counts* doesn't carry over to a share of *cost*.
- **Weighting.** Survival is a rate over *paths*, not an average of per-session rates (`src/survival.ts:333-342`). A mean of ratios is not a ratio of sums, so pick one on purpose.

The general form of this is **Simpson's paradox**: a pooled figure can point the opposite way from every subgroup inside it. It's one reason declared and captured sessions are never pooled (`survival.ts:314-320`). For the same kind of reason, costs are reported as a median and a nearest-rank p90 rather than a mean (`src/estimate/figures.ts:179-191`), because cost distributions have long tails.

**SAY THIS.** "Don't add up quantities that have different unit prices, because you can't turn the total back into money. I keep four token counters because input, cache reads, cache writes and output bill at different rates, and one total can hide a 50× cost difference."

**Drills**

1. Build two sessions where A has more total tokens than B but costs less. Use the sample rates above.
2. Build a two-session example where the mean of per-session survival rates and the path-weighted rate differ by more than 30 points. Which question does each figure answer?
3. Under the `git` rule, why is `emptyTurnTokens` present only when *every* turn was empty? What would a proportional estimate get wrong about agent sessions specifically?

---

## 7. Absence vs zero

**The problem.** `0` is a measurement. `null` means nothing was measured. Treat them as the same and you get numbers that are confidently wrong. The Session shipped this bug twice (`CHANGELOG.md:143-152`, `CHANGELOG.md:384-388`):

- A week where no model had a known price showed a total of `$0.00`.
- A session with no transcript showed a cost of `$0.00`.

Both read as "free", both meant "unknown", and figures like that end up on invoices.

**The analogy.** A thermometer that reads 0° when it's unplugged.

**What's actually happening.**

- **Per session.** `wasMeasured` asks whether there were any turns (`src/pricing.ts:287-304`). If not, `sessionFigure` returns `undefined`, not `0` (`pricing.ts:306-333`), and each view picks its own word for "no figure": an em dash, or "not captured".
- **Per window.** `unpricedThroughout` requires `usd === 0` *and* at least one unpriced or uncaptured session (`pricing.ts:281-285`). A window that genuinely cost nothing still shows `$0.00`.
- **Rounding.** `formatUsd` prints `<$0.01` instead of `$0.00` for tiny non-zero amounts (`pricing.ts:335-351`). Rounding can invent a false zero too.
- **Unknowable figures.** `emptyTurnsOf` returns `number | undefined`. When a session changed files, git can't say *which* turns were empty, so there is no figure (`src/empty.ts:21-56`).
- **Totals.** `emptyTurnsTotal` is all-or-nothing: one unknown session makes the total unknown, because a partial sum looks exactly like a complete one (`empty.ts:121-143`). SQL does the opposite, since `SUM` silently skips NULLs.
- **Empty logs.** `verify` keeps "intact" and "empty" as separate questions, so a log with no records can't pass by default (`src/verify.ts:70-82`).

**The repo isn't perfectly consistent**, and the exceptions teach something. A session nobody declared a scope for records `drift: []`. That empty array means "not measured", and only `intentSource` tells you so (`src/commands/stop.ts:45-63`). Likewise `median` is set to `0` when nothing could be priced, and the `priced` count next to it carries the meaning (`src/estimate/figures.ts:264-267`). In both cases, absence is encoded as a zero plus a side field.

**SAY THIS.** "Zero is a claim; null is an admission. I keep them as different types, `number | undefined`, and any total that includes an unknown is unknown, because a partial sum looks exactly like a complete one."

**Drills**

1. A week has three sessions: one priced at $4.00, one on a model with no rate, one with no transcript. Walk through `spendOf` (`pricing.ts:167-197`). What total and what notes should `week` print?
2. `drift: []` means two different things depending on `intentSource`. Propose a type that makes them different values. What would it cost, given that records already on disk are hashed?
3. When is the all-or-nothing rule in `emptyTurnsTotal` too strict? Propose a display that is still honest.

---

## 8. Functional core, imperative shell

**The problem.** When logic is tangled with I/O, it's hard to test (you need a git repo, a clock and a filesystem) and hard to reason about (results depend on hidden state).

**The analogy.** A restaurant. The kitchen follows recipes: ingredients in, dish out. The front of house deals with the world: orders, payment, the door. You can test a recipe without opening the restaurant.

**What's actually happening.** `session stop` is the textbook split.

- **The shell.** `stopSession` does every side effect: it reads the log, runs `git diff`, reads the clock, reads transcripts and appends a record (`src/commands/stop.ts:73-93`).
- **The core.** Every decision is handed to a pure function:
  - `computeReality` (`stop.ts:32-35`)
  - `computeDrift` (`stop.ts:41-43`)
  - `classifyPaths`
  - `reconcileEmpty` (`src/empty.ts:104-119`)

The same shape repeats across the repo:

- **Gather once, judge many.** `gatherRepoFacts` asks git everything it needs once (`src/git/blobs.ts:91-112`). `outcome.ts` is pure over those facts (`src/outcome.ts:14-15`), and the same facts are shared by every session being judged. Batching the I/O falls out of the design.
- **Checking.** `checkChain` is pure over lines and a key. Reading files happens in `commands/verify.ts` (`src/verify.ts:5-9`). `chain.ts` is pure end to end (`src/chain.ts:19`).
- **The clock is a parameter.** Survival takes `now` as an argument (`stateOf`, `src/survival.ts:143`; `summarizeSurvival`, `survival.ts:284-287`), so a test can put a session on day 13 or day 15.

**Where the split stops.** The CLI itself has no way to inject a clock. The sweep demo in `docs/decisions.md` ("Nobody remembers to run it") was produced by shifting the system clock. The pure core can be tested at any date; the shell only at *now*. Also, `CLAUDE.md` says effects live in `commands/` and `store.ts`, but in practice `git/` and `sync/plumbing.ts` are shell too.

**SAY THIS.** "I push decisions into pure functions that take facts and return values, and keep I/O in a thin shell that gathers the facts and writes the results. The core is testable without a disk, a repo or a clock, and gathering facts once tends to batch the I/O for free."

**Drills**

1. List every side effect in `stopSession`. `endedAt` is read before `captureCost` runs. Why does that order matter?
2. Write the signature of a pure function that decides survival fates. What goes in, what comes out, and what stays in the shell? Compare your answer with `fateOf` (`src/survival.ts:157-175`).
3. Estimate the number of git calls for 20 sessions of 5 paths each, with and without "gather once". Which call dominates?

---

## 9. Exhaustiveness and illegal states

**The problem.** Two separate problems:

- **Forgotten cases.** Add a new variant, say a fourth intent source, and it quietly falls into some default branch. A check like `if (source !== "captured")` now answers yes for the new source, whether or not that's right.
- **Nonsense combinations.** Types that allow them push validation into every caller: a "priced" result with no dollar amount, or an "unpriced" result that has one.

**The analogy.** A dropdown menu instead of a free-text box. And a vending machine that won't take your coin while the sold-out light is on.

**What's actually happening.**

**Exhaustiveness through tables.** `INTENT_SOURCES` is a `const` array, and the union type is derived from it (`src/store/record.ts:146-148`). Decisions go through tables typed `Record<IntentSource, T>`, such as `HAS_SCOPE` (`record.ts:268-278`). Add a source to the array and `tsc` fails at that table until someone gives an answer. The comment explains why it isn't written as `!== "captured"`. Other examples:

- `WHERE_IT_WENT: Record<SessionOutcome, string>` (`src/render/terminal/brief.ts:56-61`)
- survival's `bySource`, written as an object literal specifically so that a missing key is a compile error (`src/survival.ts:314-320`)

**Illegal states made unrepresentable.**

- `Price` is a discriminated union, and `usd` exists only on `{ priced: true }` (`src/pricing.ts:74-99`). You can't read a dollar figure without checking which case you have.
- `WindowState` names five states instead of using a nullable number (`survival.ts:122-133`).
- `SessionPatch` leaves `intent` out at the type level (`record.ts:313-324`).

**Where types stop.** The data is JSON on disk, and types disappear at runtime. So `refusePatch` repeats the intent rule at runtime (`src/store/append.ts:228-255`), and `keptIntent` repeats it again in the reader (`src/store/read.ts:340-362`). That's defence in depth: the type, then the writer, then the reader.

**Honest gaps.**

- `parseOutcome` lists the four outcomes by hand in an `if` and in a message string (`src/outcome.ts:108-119`). Add a fifth outcome and this still compiles, then quietly rejects it.
- `emptyTurns?`, `emptyTurnTokens?` and `emptySource?` are three optional fields whose valid combinations are only written down in comments (`record.ts:25-76`).
- The repo never uses `never` exhaustiveness checks (`const _exhaustive: never = value` in a `switch` default). Prove-it task 4 adds one.

**SAY THIS.** "I derive unions from one const list and branch through `Record<Union, T>` tables, so adding a variant is a compile error at every decision. I shape data as discriminated unions so a field can only be read in the state where it means something, and I re-check at runtime wherever data crosses a JSON boundary."

**Drills**

1. Add `"imported"` to `INTENT_SOURCES`. Predict three places `tsc` fails, and one place it doesn't fail but should.
2. Rewrite `parseOutcome` so a new outcome can't be forgotten.
3. Intent immutability is enforced in three places: the type, the writer and the reader. If you could keep only one, which would it be, and why?

---

## 10. Falsifiable tests, and what underpowered means

**The problem.** The product rests on the idea that declaring intent before the work helps. A claim that no result could contradict isn't evidence. Tests fail in two ways:

- **It can't fail.** The thing being measured can hit a perfect score trivially.
- **It can't see.** The sample is too small to detect a real effect.

**The analogy.** One smoke detector has no battery. Another is so insensitive it only goes off once the house is already burning.

**What's actually happening.** `evidence/intent-query.mjs` opens with a hypothesis that could be proven wrong: do sessions with a declared intent merge more often than captured ones (`intent-query.mjs:1-2`)? Its design choices are worth copying:

- **It tests the real rules.** It imports them from `dist/` rather than reimplementing them, because "a query that reimplemented them would be measuring the reimplementation" (`intent-query.mjs:4-10`).
- **Denominators are explicit.** Open and empty sessions are held out, for different reasons, and both are counted (`intent-query.mjs:39-58`).
- **Merges are judged at the first look**, not today (`firstLook`, `src/estimate/figures.ts:212-215`). Otherwise work rescued weeks later would inflate the rate.
- **Confounds are stated.** Captured sessions have no scope, so drift is undefined for them. A median over zeros "would read as captured sessions drift less" (`intent-query.mjs:61-72`).
- **The denominator can be audited by eye.** Every decided session is printed, one per line (`intent-query.mjs:124-143`).
- **Small samples get no rate.** Under `MIN_SESSIONS = 5`, rates are withheld (`figures.ts:20-21`, checked at `intent-query.mjs:118-121`).

The commit that added the script is titled "underpowered by construction". **Power** is the chance of detecting an effect that really exists. A rough sample size per group for comparing two proportions:

> n ≈ (z₁₋α/₂ + z₁₋β)² · (p₁q₁ + p₂q₂) / (p₁ − p₂)²

Take 60% vs 80% with α = 0.05 and 80% power: 7.84 × 0.40 / 0.04 ≈ **78 per group**. The script's own comment mentions "a rate over eight sessions" (`intent-query.mjs:125`). At that size, a real 20-point difference is usually invisible, and an observed 20-point difference is usually noise. The groups aren't randomised either, because the developer chooses when to declare.

**A test that couldn't fail**, from the rejected first version of Prime (`docs/decisions.md`, "`prime` — a proposed scope from the repo's own history"). A proposed scope of `src/` plus `test/` scored 100% recall by covering 139 of 142 files: "It scores perfectly by making the measurement impossible." The current evaluation reports tree coverage next to recall. It also runs walk-forward: it only uses history from before each target session, so nothing leaks backwards (`evidence/prime-evaluate.mjs:3`, `:15`, `:37`).

**SAY THIS.** "A test is falsifiable if some plausible result would make me drop the claim, and powered if the sample could actually produce that result. With eight sessions per group, a null result means 'couldn't tell', not 'no effect', so I report counts and denominators and withhold the rate."

**Drills**

1. Work out n per group to detect 70% vs 80% at α = 0.05 with 80% power. For one developer running 5 sessions a week, split evenly, how many months is that?
2. Name two confounds in declared vs captured other than sample size, and propose a design change for each. "More data" doesn't count.
3. Design a metric for a scope-proposer that can't be gamed by proposing a huge scope. Why does precision on its own also fail?

---

## 11. Survival analysis and censored data

**The problem.** You want to know what fraction of merged code is still there 14 days later. But some code merged 3 days ago, and some merged 200 days ago with nobody checking on day 14. Each shortcut goes wrong:

- **Count the 3-day-old code as not surviving** and the rate drops every time you merge something.
- **Count it as surviving** and you're making up results.
- **Ignore timing** and you're mixing different questions into one number.

**The analogy.** A clinical trial where patients join on different days. When you analyse the data, someone who joined last week hasn't failed to survive a year. They just haven't had a year yet.

**What's actually happening.** Survival analysis studies *time until an event*, with **censoring**. A right-censored subject is one you know had no event by some time, but you don't know what happened after. The standard tool, the Kaplan–Meier estimator, uses every subject for as long as it was actually observed.

**Not in this repo:** Kaplan–Meier, hazard rates, or anything continuous. The Session uses a simpler fixed-window design and names every way a measurement can be missing. `WindowState` has five states (`src/survival.ts:122-133`):

| State | Meaning | Treatment |
|---|---|---|
| `measured` | Checked on time, answer written down | In the rate |
| `pending` | Window hasn't closed yet: right-censored | Kept out of the denominator, never a failure (`survival.ts:135-142`) |
| `due` | Window closed, not checked yet | Still answerable within `CHECK_GRACE_DAYS = 7` (`survival.ts:39-49`) |
| `missed` | Closed too long ago | Today's tip isn't evidence about day 14, so counted, never guessed |
| `unsettled` | Merged, but no observed date | No starting point to count from (`mergedAt`, `survival.ts:98-114`) |

`stateOf` works these out from the record plus an injected `now` (`survival.ts:143-155`).

**Two subtleties.**

- **The clock starts when the merge was *observed*, not when it happened.** A squash merge leaves no trustworthy date, so a session settled late gets late windows (`survival.ts:98-107`).
- **The answer has to be written down at the time.** Per-path fates (`fateOf`, `survival.ts:157-175`) are signed into the log, because checking the branch tip later can't see a file that was rewritten and then restored (`src/store/record.ts:232-242`).

**A bias to watch for.** If `missed` sessions differ in some systematic way (say, older code from before the tool was adopted), the measured rate is biased. Statisticians call this informative missingness.

**SAY THIS.** "Subjects whose window hasn't closed are censored, not failures. I compute the 14-day rate only over subjects actually observed at 14 days, report pending and missed separately, and never back-fill a closed window from today's state."

**Drills**

1. Ten sessions merged. Six were measured at 14 days and five of those survived. Three are pending and one was missed. What's the rate and its denominator? What would a naive survived ÷ merged figure say?
2. Could you rebuild a day-14 answer later from `git log` on the default branch? What would make that unreliable?
3. Sketch how Kaplan–Meier would use the pending sessions instead of dropping them. What does it assume about censored subjects, and when does that assumption fail?

---

## 12. Local-first architecture

**The problem.** A cloud-backed tool makes your data depend on someone else's uptime, business model and security, and every read is a round trip over the network. For a record whose value is being trustworthy evidence about your own work, a server is also one more party that could change it.

**The analogy.** A paper notebook you own, compared with a notebook that lives at the stationer's and gets lent to you. You can still photocopy pages of your own to hand around.

**What's actually happening.** Invariant 2 in `CLAUDE.md`: no server, no database, no account. The data is `~/.session/<repo-hash>.jsonl`. The private key is generated on the machine, and "there is nowhere to send it to" (`src/keys.ts:16-19`).

Collaboration still works without a server (`src/sync/refs.ts:5-37`):

- **Transport** is a git remote the team already has. Records travel as git objects on `refs/session/<fingerprint>`.
- **One ref per signing key.** Two machines never write the same ref: "Conflict is not resolved here; it is made impossible." This is single-writer partitioning, the cheapest alternative to CRDTs or consensus.
- **Pull never merges** other people's records into your log. Peers are read-only.
- **Push refuses a log that doesn't verify** (`src/sync/publish.ts:47-60`).
- **Rewrites are visible.** Each push is a commit whose parent is the previous push, so a rewritten history shows up as a tip that doesn't descend from the old one (`refs.ts:19-23`).

**What you give up:**

- **A witness.** Truncation can't be detected locally (`src/chain.ts:14-17`).
- **Revocation and a key directory.** Fingerprints stay claims (`src/verify.ts:46-55`).
- **Real-time and global views.** A cross-team query only works after everyone pulls.
- **Managed backups.** They're the user's problem.
- **Several people editing one document.** That needs CRDTs such as Automerge or Yjs. None are in this repo, which avoids the problem by never sharing a writer.

**What you gain:**

- It works offline, with no operations to run.
- There's no data custody and no breach surface.
- Reads are as fast as the local disk.
- The data outlives the vendor.
- The format can be read with `cat` and `git cat-file` (`docs/decisions.md`, "Sharing them with the team").

The standard reference is Kleppmann, Wiggins, van Hardenberg and McGranaghan, *Local-first software* (Ink & Switch, 2019).

**SAY THIS.** "Local-first means the authoritative copy lives on the user's device and sync is optional. I avoided merge conflicts not with CRDTs but by partitioning writes, one ref per signing key, so no two machines ever write the same thing. The price is no central witness, no revocation and no global query."

**Drills**

1. One developer copies the same key onto two laptops. What breaks in the one-ref-per-key design?
2. Still without running a service, what would you add to detect a teammate cutting off the tail of their log before pushing? (Hint: look at the ref's own commit history.)
3. Name one concrete requirement that would force this tool to have a server.

---

## The twelve SAY THIS lines

1. **Event sourcing.** I store events, not state. Every change is an appended patch, and current state is a fold over the log. That gives me history and crash safety, and it gives me a place to enforce write-once rules that a hand-edited file can't get around.
2. **Hash chains.** Each record commits to the hash of the one before it, so changing or deleting a record breaks every link after it. It's tamper-evident, not tamper-proof, and a single chain can't detect a cut-off tail unless someone outside holds the latest head.
3. **Signatures.** A signature proves that whoever holds a specific private key signed specific bytes. It says nothing about time, truth or which human. Binding a key to a person is a separate, out-of-band problem, which is why a fingerprint inside a log is a claim, not a proof.
4. **Content addressing.** Git identifies content by its hash, so identical bytes have the same identity whichever commit carries them. A squash merge throws away commits but not bytes, so to detect a merge I record the blob ids a session left and look for them in the default branch's history.
5. **Idempotence.** At-least-once delivery plus an idempotency key gives you effectively-once effects. For transcripts the key is the requestId: streaming repeats a call's usage across fragments, so I count each requestId once instead of summing lines.
6. **Aggregates.** Don't add up quantities that have different unit prices, because you can't turn the total back into money. I keep four token counters because input, cache reads, cache writes and output bill at different rates, and one total can hide a 50× cost difference.
7. **Absence vs zero.** Zero is a claim; null is an admission. I keep them as different types, `number | undefined`, and any total that includes an unknown is unknown, because a partial sum looks exactly like a complete one.
8. **Functional core.** I push decisions into pure functions that take facts and return values, and keep I/O in a thin shell that gathers the facts and writes the results. The core is testable without a disk, a repo or a clock, and gathering facts once tends to batch the I/O for free.
9. **Exhaustiveness.** I derive unions from one const list and branch through `Record<Union, T>` tables, so adding a variant is a compile error at every decision. I shape data as discriminated unions so a field can only be read in the state where it means something, and I re-check at runtime wherever data crosses a JSON boundary.
10. **Falsifiability and power.** A test is falsifiable if some plausible result would make me drop the claim, and powered if the sample could actually produce that result. With eight sessions per group, a null result means "couldn't tell", not "no effect", so I report counts and denominators and withhold the rate.
11. **Censoring.** Subjects whose window hasn't closed are censored, not failures. I compute the 14-day rate only over subjects actually observed at 14 days, report pending and missed separately, and never back-fill a closed window from today's state.
12. **Local-first.** Local-first means the authoritative copy lives on the user's device and sync is optional. I avoided merge conflicts not with CRDTs but by partitioning writes, one ref per signing key, so no two machines ever write the same thing. The price is no central witness, no revocation and no global query.

---

## Prove it

Reading isn't knowing. Each task below needs working code and has a clear finish line. Do them on a scratch branch. None of them should change what the tool writes to disk.

### 1. A truncation witness (topics 1–3)

Write a pure function:

```ts
checkWitness(lines: RawLine[], witness: { count: number; head: string }): "ok" | "truncated" | "forked"
```

Use `lineHash` from `src/chain.ts`. `head` is the line hash of the record at position `count`.

Write three tests:

- an intact log that has grown since the witness was taken
- a log with its last three lines removed
- a log where line 5 was edited and every later `prev` recomputed

Then write the 20 or so lines of shell code that read a witness from the *previous* push on `refs/session/<fingerprint>` with `git cat-file`.

**Done when** all three tests pass and you can name the attack that still gets through.

### 2. Deduplication under a harder delivery model (topic 5)

Write `recordCallCumulative`. It should assume fragments carry *cumulative* usage and can arrive in any order.

Write a property test. Use fast-check, or 50 hand-rolled random shuffles. Assert that:

1. shuffling the fragments doesn't change the result
2. feeding any fragment twice doesn't change the result
3. each counter equals the maximum seen for that `requestId`

**Done when** the same test *fails* against the shipped `recordCall` (`src/capture/transcript.ts:172-192`) and you can explain in one sentence why.

### 3. Power by simulation (topic 10)

Write a script that simulates declared and captured sessions with true merge rates p₁ and p₂. For each run, draw n sessions per group and apply a two-proportion z-test or Fisher's exact test. Repeat 10,000 times.

Print a table of power for n ∈ {8, 20, 50, 100, 300}, at (p₁, p₂) = (0.6, 0.8) and at (0.7, 0.8).

**Done when** your simulated power at n = 78 is within a few points of 80% for (0.6, 0.8), and you can state the smallest difference n = 8 detects with 80% power.

### 4. Make one illegal state unrepresentable (topics 7 and 9)

On a scratch copy of `SessionCost`, replace `emptyTurns?`, `emptyTurnTokens?` and `emptySource?` with a discriminated union, for example:

```ts
type EmptyMeasure =
  | { rule: "none" }                                          // never reconciled
  | { rule: "git"; wroteFiles: false; tokens: TokenCounts }   // every turn empty
  | { rule: "git"; wroteFiles: true }                         // unknowable per turn
  | { rule: "tools"; emptyTurns: number; tokens?: TokenCounts }
```

Then write three things:

1. `parseEmpty(raw: SessionCost): EmptyMeasure`, which maps every record shape already on disk into the union
2. your own `emptyTurnsOf`, as a `switch` with a `never` check in the default case
3. table-driven tests covering each of the three cases described in `src/empty.ts:25-41`

**Done when** adding a fifth variant fails compilation at your `switch`, and you've written one paragraph explaining why the *stored* record can't simply change shape to match. Hint: `src/store/record.ts:36-49`, and topic 2.
