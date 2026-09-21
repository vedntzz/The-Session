# Session: understand it, explain it, defend it

A hands-on interview handbook. Based on source revision `7f633a0`, inspected September 2026.

**Start with the little picture. Then learn the real name. Then prove you understand it.** You do not need to memorise the whole repository.

This guide describes the code that exists. The live supervising harness and cinematic terminal we discussed are a proposed next version, not shipped capabilities.

## How to study this

Read one numbered lesson. Close it. Explain it aloud using the example. Open its source link and find the named function. Answer the check question before opening the answer.

| If you have… | Study this |
|---|---|
| 15 minutes | Lessons 1–4 and the interview traps |
| An hour | Lessons 1–10 and the small lab |
| Several study sessions | All lessons, the debugging map, then the mock interview |

Read in order the first time:

- [1. The product](#1-the-product-a-before-and-after-notebook)
- [2. What exists](#2-what-exists-and-what-does-not)
- [3. The code map](#3-the-code-map-follow-one-request)
- [4. One session](#4-one-session-from-start-to-stop)
- [5. Storage](#5-storage-a-notebook-you-add-to)
- [6. Tamper evidence](#6-hashes-and-signatures-two-different-jobs)
- [7. Token capture and money](#7-token-capture-and-money)
- [8. Empty versus unknown](#8-empty-zero-and-unknown-are-different)
- [9. Outcomes](#9-did-the-work-actually-land)
- [10. Prime](#10-prime-help-before-the-work)
- [11. Debt, estimates, survival](#11-three-reports-three-different-questions)
- [12. Sharing](#12-sharing-with-git)
- [13. Commands](#13-the-command-map)
- [14. Testing and debugging](#14-how-to-test-and-find-your-way-around)
- [15. Small lab](#15-a-small-lab-you-can-explain)
- [16. Future harness](#16-the-future-harness-is-a-separate-step)
- [17. Interview practice](#17-interview-practice)

## 1. The product: a before-and-after notebook

Imagine asking someone to fix one broken toy. They return with five toys taken apart. You want to know what you asked for, what they touched, and what became of the work.

Session keeps that notebook for AI coding work.

```text
BEFORE                       AFTER                      LATER
What did I ask for?          What files changed?        Did the content land?
Where should work happen?   What was outside scope?    Did it remain there?
                            What usage was recorded?
```

**The actual product:** a local command-line tool that compares declared intent and scope with observed repository changes, records usage, and reports outcomes.

**Important boundary:** the comparison is mostly about paths and recorded facts. Session does not read your sentence and prove that the implementation satisfies it.

### Your 30-second explanation

> “Session records the task before an AI coding session starts, then compares the expected files with the Git changes left afterward. It captures available usage, checks whether recorded file contents reached the default branch, and keeps a signed local history. It uses explicit rules rather than asking another model to judge the work.”

Say this as an explanation of the project. Describe your own contribution separately and truthfully; understanding code and personally writing every line are different claims.

**Check:** A session changes 30 files. Does that prove it was bad?

<details><summary>Answer</summary>

No. A migration might need 30 files. Session can report that some were outside the declared scope. Whether the expansion was justified requires more evidence and human judgment.

</details>

## 2. What exists and what does not

| Capability | Current reality |
|---|---|
| Record intent and expected paths | Implemented |
| Compare Git changes with scope at stop | Implemented |
| Capture transcript usage | Claude Code adapter implemented |
| Add other coding tools | Adapter interface exists; additional adapters require implementation |
| Suggest scope before work | Prime, using deterministic history rules |
| Weekly, debt, survival reports | Implemented, subject to measurement limits |
| Signed logs and sharing over Git | Implemented |
| Live terminal control room | Proposed; the conversation mockup is not CLI code |
| Pause an out-of-scope edit | Proposed; current hooks record lifecycle events |
| Explain why each code change is necessary | Not established by the current record |
| Automatically fix architecture or technical debt | Not implemented |

**Remember:** an extensible design is not the same as shipped integrations.

**Source:** [default adapters](../src/capture/index.ts), [current hooks](../src/capture/hook.ts), [Prime](prime.md).

## 3. The code map: follow one request

Think of a small restaurant. The counter hears the order, the kitchen follows a recipe, and someone brings the result back.

```text
You type a command
        |
        v
src/cli.ts                 executable entrance
        |
        v
src/program.ts             assembles available commands
        |
        v
src/program/start.ts       understands arguments and flags
        |
        v
src/commands/start.ts      coordinates the work
        |
        +--> Git helpers   read repository facts
        +--> config.ts     read attribution
        +--> store.ts      save the record
        |
        v
formatted output           tells you what happened
```

### Five boxes to remember

| Box | Job | Example |
|---|---|---|
| `program/` | Parse what the person typed; wire actions and output | `registerStart` |
| `commands/` | Coordinate reads, decisions, and writes | `startSession` |
| Core rule files | Calculate an answer from supplied data | `inScope`, `classify`, `proposeScope` |
| Storage, Git, capture | Talk to the outside world | `writeRecord`, `changedFilesSince`, adapter |
| `render/` | Turn results into readable output | terminal, Markdown, HTML, PR body |

Some formatting and side effects live in command registration or other helpers. This is a useful design direction, not a claim of perfectly enforced layers.

### Three technical words, made small

**Pure function:** a calculator. The same inputs give the same output, without reading disk or changing anything outside itself. `inScope(scope, file)` is an example.

**Side effect:** touching the outside world. Reading Git, writing a file, and printing output are examples.

**Dependency injection:** giving a function its supplies. Tests pass a temporary storage home or fake adapter instead of letting it use your personal data.

The architectural name is **functional core, imperative shell**: calculation in the middle, interactions around it.

### Why this stack?

Node runs the CLI and talks to files and Git. TypeScript checks data shapes before execution. Commander handles arguments. Picocolors supplies terminal colour. `tsc` compiles source into `dist/`; there is no bundler or application server.

ESM means JavaScript's `import`/`export` module system. Types help during development; they do not automatically validate JSON read from someone else's disk.

**Read:** [program assembly](../src/program.ts), [start registration](../src/program/start.ts), [start workflow](../src/commands/start.ts), [compiler settings](../tsconfig.json).

**Check:** Where should a new scope rule go: the terminal renderer or the core?

<details><summary>Answer</summary>

The core. Otherwise two output formats could calculate different answers. A renderer should display the rule's result.

</details>

## 4. One session from start to stop

Use this one example throughout the guide:

```sh
session start "Fix login timeout" --scope src/auth/ test/auth/
# The developer and agent do their work.
session stop
session week last --full
```

These commands run inside a Git repository with at least one commit.

### Start: take the before picture

`startSession` checks the input, refuses an already-running session, and collects:

- The intent: “Fix login timeout.”
- Scope: the paths we expected to touch.
- Start commit: the Git reference point for comparison.
- Baseline: files already dirty before this session.
- Start time and any attribution from `.session.json`.

Then it creates a session record.

**Dirty** means different from the committed reference, including relevant untracked files. It does not mean low-quality code.

### Stop: compare pictures

Suppose the facts are:

```text
Already dirty at start:
  README.md

Different from the start commit at stop:
  README.md
  src/auth/login.ts
  src/config/retry.ts
  test/auth/login.test.ts
```

The rule is:

```text
reality = changed paths minus baseline paths

drift = reality paths outside declared scope
```

Therefore:

```text
reality:
  src/auth/login.ts
  src/config/retry.ts
  test/auth/login.test.ts

drift:
  src/config/retry.ts
```

The README disappears because it was already dirty. The config file remains because it changed and was not in the declared scope.

`stopSession` also captures available usage, classifies paths, records end-state content identifiers, and appends the closing fields.

### Scope is a fence made of path prefixes

`src/auth/` covers `src/auth/login.ts`. `src/auth` does not cover `src/authentication.ts`. The match stops at directory boundaries.

This is not a glob language, semantic code search, or dependency analysis.

### The limits matter

Baseline subtraction is **per file**, not per line. If you already edited `login.ts` and the agent edits it again, the file is excluded by the baseline rule. Session cannot split ownership of those edits.

A final diff is a net result. A file edited and restored during the session may leave no difference. Untracked ignored files are not included. Session also cannot reliably distinguish a human's concurrent edit from an agent's edit in that checkout.

### Passive sessions

The existing hooks open a session at `SessionStart`, capture its first prompt at `UserPromptSubmit`, and close it at `SessionEnd`.

A passive session initially has `intent: null`. Its first prompt fills that once. Its intent source is `captured`, rather than a deliberate `declared` scope commitment. Passive work is not treated as if every changed file violated a plan nobody made.

**Read:** `openingFacts` and `startSession` in [start](../src/commands/start.ts); `computeReality`, `driftOf`, and `stopSession` in [stop](../src/commands/stop.ts); [scope matching](../src/scope.ts); [Git diff reader](../src/git/changes.ts).

**Check:** Does `endedAt !== null` mean the work merged?

<details><summary>Answer</summary>

No. It means recording of that work session stopped. Its outcome may still be `open`: the work exists but has not landed or been abandoned.

</details>

## 5. Storage: a notebook you add to

### First learn the shapes

| Field | Plain meaning |
|---|---|
| `id`, `repo` | Which session, in which repository |
| `intent`, `intentSource` | What was asked and how that statement was obtained |
| `scope` | Expected paths |
| `startCommit`, `baseline` | The before picture |
| `reality`, `drift` | The after picture and scope difference |
| `startedAt`, `endedAt` | Recording interval; `null` end means still running |
| `cost` | Token counters, turns, calls, model label, measurement metadata |
| `class` | Coarse category such as API, UI, or tests |
| `endState` | File-content identifiers at stop; `null` means deleted |
| `observations` | Recorded outcome checks or manual marks |
| `survival` | Recorded later checks of content persistence |
| `attribution` | Who the work was for, copied at start |
| `proposal` | Prime's original suggestion, when used |

The complete definitions are in [store/record.ts](../src/store/record.ts). A `Session` is the reconstructed result; a `LogRecord` is one line used to build it.

### JSONL and replay

**JSON** is a text format for structured data. **JSONL** puts one JSON object on each line.

A simplified teaching example, not the full signed format:

```json
{"id":"s1","set":{"intent":"Fix login timeout","endedAt":null}}
{"id":"s1","set":{"endedAt":"2026-09-20T12:00:00Z","reality":["src/auth/login.ts"]}}
```

The reader starts with the creating record and applies later patches for the same ID. This is called a **fold** or **replay**. Think: follow the notebook from top to bottom to discover the latest state.

This is an event-sourcing style design, although these records are field patches rather than richly named events like `SessionStopped`.

### Why append instead of overwrite?

Overwriting erases earlier values. Appending preserves the history of changes. Intent is additionally protected: normal update code refuses intent edits, and replay preserves the first non-null intent. You cannot casually change the original promise after seeing the result.

But someone who controls the disk can rewrite bytes. Append-only behaviour is a software rule, not a magical filesystem guarantee.

### Where does the file live?

Normally `~/.session/<repo-key>.jsonl`. `SESSION_HOME` or supplied test options can choose another home.

Repository identity prefers the normalised `origin` URL; without one it uses the repository path. SHA-256 of that identity, shortened to 16 hex characters, supplies the filename key. Equivalent SSH/HTTPS remote forms are normalised. Earlier path-based logs can be found when a remote is added; the old log is not silently rewritten.

### Why a lock?

Two people cannot safely write the next page number at the same time:

```text
Without a lock:
  Writer A reads the last record.
  Writer B reads the same last record.
  Both claim to be the next record.

With the append lock:
  A reads and writes.
  B then reads A's new record and writes after it.
```

`withLock` uses an exclusive lock-file creation. The lock protects the read-last-line/sign/append sequence. A 10-second stale timeout permits recovery, but also assumes a healthy critical section does not remain active beyond that period. It is not a general distributed lock or transaction system.

**Crash handling:** replay tolerates an unparsable final unterminated line. A malformed middle record is an error. This is limited recovery, not a promise that power loss cannot lose data or that every damaged file repairs itself.

**Scaling tradeoff:** replay reads history rather than an indexed database. More history means more work. Snapshots or indexes could help later, but would need to preserve verification and replay semantics.

**Read:** [append](../src/store/append.ts), [read and fold](../src/store/read.ts), [repository identity](../src/store/paths.ts).

## 6. Hashes and signatures: two different jobs

### A hash is a fingerprint

Give a hash function some bytes; it returns a short identifier. Change the bytes and the identifier will very likely change. It is not encryption: the recorded text is still readable.

Each new record contains:

```text
prev  = hash of previous raw line, without its newline
hash  = hash of this record's canonical body
sig   = signature over the bytes represented by hash
```

**Canonical** means “written in one agreed order.” `canonicalJson` sorts object keys recursively so the body hash is reproducible. Array order is retained.

The distinction matters: the current body uses canonical values, but the link to the previous line uses its actual text bytes. Reformatting an earlier line can therefore break the next link even if its own body hash still checks.

### A signature is a seal

A private key makes the seal. A public key checks it. Session uses Ed25519 through Node's crypto facilities. The private key stays local; it is not embedded in the log.

Hash links detect inconsistencies. Signatures checked against a trusted public key also resist someone rewriting the chain with newly calculated hashes.

### What verification does not prove

- That the statement in the record is true.
- That its timestamp came from a trusted clock.
- That a key belongs to a particular human unless you establish that separately.
- That the private key was never stolen.
- That nobody removed the end of the log.

**Tail deletion:** removing the final pages can leave a shorter, internally valid notebook. Detecting this needs an independently retained expected head or other witness. The single local chain does not supply that guarantee.

A foreign log can have its hash chain checked without its public key. That does not mean its signatures were checked. An empty log is also not treated as a successfully verified history.

**Interview sentence:** “It is tamper-evident, with explicit trust assumptions; it is not tamper-proof.”

**Read:** [chain.ts](../src/chain.ts), [keys.ts](../src/keys.ts), [verify.ts](../src/verify.ts), [verification tests](../test/verify.test.ts).

## 7. Token capture and money

### The adapter is a translator

One tool writes its diary in one format; another could use a different format. An adapter translates either into the same `SessionCost` shape.

The interface supplies `name`, `isAvailable()`, and `capture(window)`. The current default list contains the Claude Code adapter. It reads local transcripts, matches relevant checkout/time information, and returns normalised usage.

Capture is best-effort: unavailable or unreadable transcripts should not prevent recording the Git result.

### Turn, call, fragment

```text
One developer prompt           = a turn boundary
Several model requests         = several API calls
Several pieces of one response = fragments, not extra calls
```

`recordCall` keys entries by `requestId`, counting the first recognised entry once. Repeated fragments with that ID do not add another bill. The implementation assumes the retained usage is sufficient; it does not repeatedly add or replace usage from later fragments.

Tool-result messages are not new developer prompts. The stored turn count comes from distinct turns represented by captured calls, not every conceivable message in a conversation.

### Why four token counters?

Think of buying four kinds of sweets at four prices. Knowing “20 sweets” is not enough to calculate the bill.

Session keeps fresh input, cache-read input, cache-creation input, and output separate.

```text
cost = (input × input rate
      + cache reads × cache-read rate
      + cache creation × cache-creation rate
      + output × output rate) / 1,000,000
```

Prices come from packaged `rates.json` plus local overrides. Matching uses an exact model ID or the longest allowed dash-boundary prefix. Unknown models remain unpriced.

**Important limitation:** the session shape stores aggregate counters and one dominant model label, chosen by call count. A mixed-model session does not preserve a full per-model billing breakdown. Pricing those aggregate counters at one model's rates is not an exact reconstruction of a mixed-model invoice. Subscription charges and historical vendor invoices are also separate questions.

**Read:** [adapter contract](../src/capture/adapter.ts), [Claude reader](../src/capture/adapters/claude-code.ts), `recordCall` and `costOfCalls` in [transcript.ts](../src/capture/transcript.ts), [pricing.ts](../src/pricing.ts).

**Check:** Five streaming fragments share a request ID. How many calls?

<details><summary>Answer</summary>

One. Adding each fragment's repeated usage would overcount it.

</details>

## 8. Empty, zero, and unknown are different

An empty lunchbox means no sandwiches. A closed lunchbox you never checked means you do not know. Printing zero for both loses information.

| Situation | What Session can say |
|---|---|
| Closed session has no recorded changed paths | No net recorded file change; all its counted turns are treated as empty by this rule |
| Session changed files | The final diff cannot identify which individual turns wrote them |
| No captured turns | Usage was not captured; zero counters do not establish free work |
| Captured usage, no matching rate | Usage exists but cannot be priced with this table |
| Measured usage genuinely prices to zero | A real zero is allowed |

`empty.ts` centralises the rule. Do not display `cost.emptyTurns` directly: old records used tool-name heuristics, and the compatibility logic matters.

Why were tool names misleading? A shell command can write files without ever calling a tool named `Edit` or `Write`.

Also, **no file change is not proof of no value**. A debugging investigation or explanation can be useful. This metric measures recorded net file changes, not human usefulness.

**Read:** `reconcileEmpty`, `emptyTurnsOf`, and `emptyTurnsTotal` in [empty.ts](../src/empty.ts).

**Check:** Four of ten turns seem empty. Can you assign them 40% of the bill?

<details><summary>Answer</summary>

No. Turns can have very different token usage. A turn fraction is not a measured token or dollar fraction.

</details>

## 9. Did the work actually land?

### Git has two different fingerprints

A **commit** describes a repository snapshot plus history metadata. A **blob** identifies a file's stored content.

Squashing a branch can replace its commit history while retaining its file contents. Looking only for original commits would miss that.

At stop, Session records each changed path's content identifier in `endState`. Later it asks whether that content appeared at that same path in the default branch's history.

```text
Original branch:      commits A → B → C
Squashed main branch: commit X

Commit identities differ.
A matching file blob can still show that the content landed.
```

### The outcome rule

For each path with end-state evidence, put it in a pile:

- **Landed:** its recorded content appeared in default-branch history.
- **In flight:** not landed, but the working tree still has that content.
- **Lost:** neither condition holds.

Then classify the evidence. If unlanded content remains in flight, the outcome can stay `open`. If something landed and nothing remains in flight, it can be `merged` even if some other content was lost. Without landed or in-flight evidence, it is `abandoned` under this rule.

Closed sessions with no changed paths are `empty`. A manual observation can override the computed destination for nonempty work. If repository facts or end states are unavailable, the reader falls back to the stored outcome.

### What the result does not mean

`merged` does not guarantee every line survived, every file landed, or that the work was good. Matching exact content is conservative about edited merges, does not follow renames, and cannot prove exclusive authorship.

Deletion is weaker evidence: a path absent at the branch tip can count as a landed deletion, but that absence cannot tell whose deletion it was.

Outcomes use available local Git facts; they are not a live query of a hosting provider's PR state.

`settle` records observations. Views use the effective-outcome helpers rather than blindly displaying an old field. The last manual mark has special precedence.

**Read:** [outcome.ts](../src/outcome.ts), [observe.ts](../src/observe.ts), [Git blobs](../src/git/blobs.ts), [settle](../src/commands/settle.ts).

## 10. Prime: help before the work

Imagine repeatedly forgetting the same toy part when planning a repair. A notebook can remind you next time. It does not need to understand how the toy works.

```sh
session prime "Fix login timeout" --seed src/auth/login.ts
```

This previews a proposal. `--start` accepts the newly computed proposal and opens a session. With `--start`, `--scope` replaces the suggestion with your chosen scope.

### Learn the numbers: 5, 3, 60%

- At most **5 exact tracked files** in the proposal.
- A historical candidate needs drift support from at least **3 comparable declarations**.
- It must appear in at least **60% of the comparable set**.

Comparable history must be from this repository, closed before the question, unaided (`declared`), and scoped. Similarity is at least two shared content words after filtering, or an exact match between a seed and a historical scope entry.

Named files come first. Historical candidates follow by support and path. Subsequent unaided declarations can clear earlier planning misses. Broad seeds are refused instead of silently selecting an arbitrary subset.

### Abstention is a feature

**Abstain** means “I do not have enough evidence to suggest anything.” It prevents a confident-looking guess.

The documented initial evaluation had 14 eligible unseeded cases and abstained on all 14. That is not proof of useful prediction. Seeded suggestions also contain information the user supplied, which must not be credited to the predictor.

The older rejected Prime approach sometimes achieved apparently perfect coverage by suggesting nearly the whole repository. That removes the usefulness of scope. Learn why this was rejected in [decisions](decisions.md).

### Avoid teaching the rule its own answers

Primed sessions retain `intentSource: "primed"` and the original proposal separately from the accepted scope. They do not train this rule as unaided declarations.

Otherwise: suggest a path → user accepts it → record acceptance → treat it as independent proof the suggestion was good. That is a feedback loop, not clean evaluation.

**Read:** `proposeScope` in [prime.ts](../src/prime.ts), [Prime workflow](../src/commands/prime.ts), [Prime documentation](prime.md), [Prime tests](../test/prime.test.ts).

**Check:** Is 60% a confidence score that the file is necessary?

<details><summary>Answer</summary>

No. It is a historical support threshold under a particular deterministic rule. It is not a calibrated probability or semantic necessity judgment.

</details>

## 11. Three reports, three different questions

### Debt: “What keeps surprising our plans?”

A path that repeatedly appears outside scope can reveal a planning blind spot.

The current debt rule requires at least three drifts, with at least three sessions of repository history before making a reportable judgment. Docs, config, and build classes are excluded. A declaration after the latest drift clears the path from the reported debt list.

The calculation indexes recorded drift occurrences; do not describe it as a full semantic debt detector or assume every internal counter is reset when a declaration occurs.

Associated spend is the cost of the sessions involving that path, not money attributed to the path itself. Two paths can share those sessions. Adding all path rows would double-count overlapping spend.

`session prime` prints the current repository's owed paths under its suggestion, without money; `session prime --debt` prints the full report for every repository on the machine.

**Source:** [debt.ts](../src/debt.ts).

### Estimate: removed

`session estimate` was cut on 21 September 2026. The figures it restated — cost, drift and first-look outcome of past sessions by class and intent source — are still on the record, and `week --class` still files each session under a class read off its paths. See [the v1 boundary](decisions.md#the-v1-boundary).

### Survival: “Was the recorded content still there when we checked?”

A planted flower can arrive in the garden and disappear later. Landing and remaining are different events.

Survival windows are 14 and 30 days after the **first recorded merged observation**, not a proven physical merge timestamp. A seven-day grace period permits a slightly late check. After that, a missing observation is `missed`, not retroactively guessed.

For each recorded path: same blob means survived; different blob means rewritten; missing path means deleted. A recorded deletion survives if the path remains absent.

This is whole-file content persistence, not a percentage of individual lines remaining. One small edit can change a whole file's blob. Rewriting is also not necessarily failure.

Reports distinguish measured, pending, due, missed, and unsettled windows. Aggregate survival uses path counts rather than giving a one-file session the same weight as a twenty-file session; the minimum-session gate is separate.

The built-in benchmark is an external comparison threshold, not a guarantee or a metric Session established experimentally.

**Source:** [survival.ts](../src/survival.ts), [survival checks](../src/commands/survival.ts).

## 12. Sharing with Git

Think of each developer keeping a separate signed notebook on a shared bookshelf. You can read someone else's notebook without cutting its pages into yours.

```text
local JSONL
    → Git blob containing the log
    → tree containing session.jsonl
    → commit
    → refs/session/<signing-key-fingerprint>
    → existing origin remote
```

A **ref** is a named pointer to a Git object. These refs live outside ordinary branch and tag namespaces.

`push` publishes this machine's log. `pull` fetches peer refs; it does not merge their records into the local append-only file. `peers` lists them.

One ref per key reduces competing writers. It does not eliminate conflict if two machines share the same private key and diverge. A non-fast-forward push is refused rather than silently combined.

Repeated publication of identical log bytes reuses the existing tree/commit rather than creating another identical commit. This is **idempotence**: repeating an action does not keep adding new effects. The remote push can still run to bring origin up to date.

Ordinary code branches are separate, but `git log --all` can show these refs. Published records are accessible through the remote's existing access controls. “No Session server” does not mean “sharing needs no remote” or “records stay private after pushing.”

Hash checks on peer data are not signature authentication without the appropriate trusted public key.

**Read:** [ref design](../src/sync/refs.ts), [publish and pull](../src/sync/publish.ts), [Git plumbing](../src/sync/plumbing.ts).

## 13. The command map

| Need | Command | Where to read |
|---|---|---|
| Record a plan | `start` | `commands/start.ts` |
| Suggest scope | `prime` | `prime.ts`, `commands/prime.ts` |
| Capture first passive prompt | `intent --from-prompt` | `commands/intent.ts` |
| Finish recording | `stop` | `commands/stop.ts` |
| Inspect a session | `week <id> --full` | `commands/show.ts` |
| Summarise recent work | `week` | `commands/week.ts` |
| Examine existing transcripts | `scan` | `commands/scan.ts`, `scan.ts` |
| Report planning misses | `prime --debt` | `debt.ts` |
| Record destinations | `settle`, `mark` | `commands/settle.ts` |
| Check later persistence | `survival --check` | `commands/survival.ts` |
| Produce a PR description | `pr` | `commands/pr.ts`, `render/pr.ts` |
| Check log integrity | `verify` | `verify.ts` |
| Share and inspect peers | `push`, `pull`, `peers` | `sync/` |
| Set attribution | `config set`, `config show` | `config.ts` |
| Inspect the signing identity | `key show` | `commands/key.ts` |
| Install lifecycle capture | `hook install` | `capture/hook.ts`, `commands/hook.ts` |
| Explore commands | `help all` | `program/help.ts` |

Use each command's `--help` for exact flags.

**Three easily missed facts:**

1. `scan` is a retrospective transcript report. It cannot reconstruct a scope declaration that never happened and does not create session records.
2. `pr` formats recorded facts. It does not ask an LLM to write a story or create a hosted PR by itself. Its stdout stays clean for piping.
3. A sweep can settle outcomes and perform due survival checks as commands run, at most once per day per repository under its normal gate. It is not a continuously running daemon. Some apparently read-oriented workflows therefore can append observations.

`.session.json` is checked-in attribution, not a growing general settings file. Attribution is copied at start so changing today's config does not rewrite yesterday's customer assignment.

## 14. How to test and find your way around

### Tests are examples with alarms

A test says: “Given this situation, this result must hold.” A useful test fails if someone breaks the behaviour that matters.

| Test layer | What it exercises | Example files |
|---|---|---|
| Pure rules | Supplied data → expected result | `prime.test.ts`, `classify.test.ts`, `empty.test.ts` |
| Filesystem behaviour | Append, replay, lock, keys | `store.test.ts`, `verify.test.ts` |
| Real Git integration | Commits, branches, blobs, remotes | `outcome.test.ts`, `sync.test.ts`, `stop.test.ts` |
| CLI and rendering | Flags, errors, readable output | `program.test.ts`, `terminal.test.ts`, `pr-run.test.ts` |

Many tests create temporary repositories and run real Git commands. That is stronger than mocking every Git answer, but takes longer and consumes subprocess resources.

```sh
npm run typecheck
npm test -- test/prime.test.ts
npm test -- test/stop.test.ts test/empty.test.ts
npm run build
```

Typechecking checks TypeScript, including the test configuration. Tests check behaviour. Neither alone proves the product is useful to users.

### Debug by following evidence

| Symptom | Follow this path |
|---|---|
| “A changed file disappeared” | `changedFilesSince` → baseline → `computeReality` |
| “A scope match is wrong” | `normalizeEntry` → `covers` → `inScope` |
| “Usage is missing” | adapter availability → transcript selection → time/path matching → call parsing |
| “Bill seems too high” | request-ID deduplication → token categories → selected model/rate |
| “Merged work says open” | `endState` → gathered branch facts → landed/in-flight evidence → manual observation |
| “Prime suggested nothing” | seeds → eligible history → comparable history → support thresholds |
| “Verify failed” | reported line → link/body/key/signature distinction |
| “Terminal and HTML disagree” | shared core result → individual renderers |

### Be careful when changing these areas

Measurement rules, storage signatures, and terminal output have separate repository skills. Read the applicable instructions before changing those areas. Existing logs are a compatibility surface: dropping or reinterpreting fields can break verification or alter old reports.

`docs/context.md` is generated by `evidence/gen-context.mjs`; it should not be hand-edited as an ordinary guide. The deeper [systems study sheet](study.md) is a companion, while this handbook is the guided entry point.

## 15. A small lab you can explain

This makes a disposable repository and a separate Session home. It uses the local build, not a global installation. Run the build from this project first:

```sh
cd /Users/vedant/dev-session
npm run build
```

Then run the following together in one shell. Nothing here pushes to a remote or installs hooks.

```sh
SESSION_LAB_DIR=$(mktemp -d)
SESSION_LAB_CLI=/Users/vedant/dev-session/dist/cli.js
mkdir -p "$SESSION_LAB_DIR/repo" "$SESSION_LAB_DIR/store"
cd "$SESSION_LAB_DIR/repo"
export SESSION_HOME="$SESSION_LAB_DIR/store"
git init -q
git config user.name "Session Lab"
git config user.email "lab@example.invalid"
mkdir -p src/auth src/config
printf 'before\n' > src/auth/login.txt
printf '3\n' > src/config/retry.txt
git add .
git -c core.hooksPath=/dev/null commit -qm "Baseline"
node "$SESSION_LAB_CLI" start "Fix login timeout" --scope src/auth/
printf 'after\n' > src/auth/login.txt
printf '5\n' > src/config/retry.txt
node "$SESSION_LAB_CLI" stop
node "$SESSION_LAB_CLI" show --full
node "$SESSION_LAB_CLI" verify
```

**Predict before looking:** two reality paths; `src/config/retry.txt` outside scope; no captured AI usage expected from this manual lab. Verification should cover the records written in the separate lab store.

Before returning to normal work, close that shell or run `unset SESSION_HOME` and change back to your project. Keep the temporary directory if you want to inspect its records.

### Four experiments, one at a time

1. **Baseline:** in a new lab session, dirty a file before `start`, change it again after `start`, and inspect whether it is counted. Explain why.
2. **Net change:** start with clean files, change one and restore its exact starting content before `stop`. Explain why the net diff cannot reveal the temporary edit.
3. **Prime abstention:** run a Prime preview in the tiny new repository without seeds. Explain why no history means no supported historical suggestion.
4. **Replay:** inspect the lab's JSONL. Find the same session ID on multiple lines. Explain how the latest session is reconstructed. Do not edit your real log to experiment.

## 16. The future harness is a separate step

The existing product is a recorder with planning/reporting features. The proposed harness adds observation during execution and a way to intervene.

```text
Current:
  declare → agent works → stop → compare → report

Proposed:
  declare → observe agent work → detect boundary crossing
                                    |
                                    v
                           developer decision
                                    |
                                    v
                            continue or narrow
```

Three separate jobs must not be confused:

| Job | What it establishes |
|---|---|
| Observe | A change was seen |
| Intercept | A supported operation was stopped before execution |
| Explain | An actor supplied a reason; the reason may still need checking |

Watching Git afterward cannot guarantee prevention. A hook for a named edit tool does not automatically cover arbitrary shell scripts. An agent's explanation is not a verified causal account of every line.

A future exception should preserve the original intent and distinguish the later decision. The conversation's “allow once” button is a design proposal; it is not an implemented record format or command.

A terminal interface can display these facts, but it should consume the same rules rather than calculate its own version of drift. That preserves consistency across the recorder, live view, and exported reports.

**Interview sentence:** “The next step is moving feedback earlier. The hard engineering problem is trustworthy intervention across different execution paths, not drawing the terminal panel.”

## 17. Interview practice

### Explain the project in two minutes

Use this order, in your own words:

1. **Problem:** you can lose track of an agent's scope and the result of its work.
2. **Workflow:** declare, capture baseline, observe final diff, record usage, later check outcomes.
3. **Architecture:** TypeScript CLI, deterministic core, Git/filesystem adapters, append-only local records.
4. **Interesting decision:** compare content rather than commit ancestry to handle squash merges.
5. **Honest limitation:** path-level net changes do not prove who wrote a line or why it was necessary.
6. **Next step:** a bounded live supervision integration, clearly described as future work.

### Interview traps

| Avoid saying | Say instead |
|---|---|
| “It understands intent.” | “It preserves intent and compares declared path scope with observed changes.” |
| “It detects bad code.” | “It detects recorded planning misses under explicit rules.” |
| “It supports every agent.” | “The core is adapter-based; Claude Code capture is implemented.” |
| “It measures exact agent productivity.” | “It reports specific observations and their limitations.” |
| “Zero cost means free.” | “First distinguish measured zero from unavailable usage or pricing.” |
| “Every empty turn was useless.” | “Empty here describes recorded net file changes.” |
| “Merged means every change shipped.” | “It is a content-based outcome with partial-landing rules.” |
| “Survival measures lines retained.” | “It compares whole-file content identifiers at observation time.” |
| “Signed means true.” | “A checked signature binds bytes to a key, not truth or identity by itself.” |
| “Append-only prevents deletion.” | “The application appends; verification has explicit limits, including truncation.” |
| “Prime uses AI predictions.” | “It uses bounded deterministic suggestions and can abstain.” |
| “The harness already stops drift.” | “That is the proposed next capability.” |

### Ten questions to answer without looking

<details><summary>1. Why not ask an LLM to decide whether the agent followed intent?</summary>

The current contract prioritises reproducible, inspectable measurements. An LLM judgment would introduce different assumptions, cost, and uncertainty. The tradeoff is that current rules cannot establish semantic scope satisfaction.

</details>

<details><summary>2. Why preserve the first intent?</summary>

Changing the original statement after seeing the result destroys the before/after comparison. A later decision should be distinguishable from the original commitment.

</details>

<details><summary>3. Why not put all records in one shared Git branch?</summary>

Independently signed writers would compete over one history. Separate refs per key preserve provenance and avoid normal cross-writer merge conflicts, while shared-key divergence remains a real exception.

</details>

<details><summary>4. Why is a final diff insufficient for turn-level attribution?</summary>

It shows the net repository state relative to a reference, not the sequence of authors and turns that produced it. Edits can overlap or be reverted.

</details>

<details><summary>5. What is the difference between a test and an evaluation?</summary>

A test can prove the rule implements “at least three supporting sessions.” An evaluation asks whether that rule makes useful suggestions on representative data. Correct implementation does not prove product value.

</details>

<details><summary>6. What would you improve for accurate mixed-model pricing?</summary>

Preserve usage per model before aggregation, then price each model separately. That is a proposed schema evolution requiring compatibility, hashing, and rendering decisions, not just a formula change.

</details>

<details><summary>7. Where could performance become expensive?</summary>

Full log replay, transcript scanning, and Git history queries. Repository facts are gathered and reused where possible. Measure actual time before adding caches; any cache needs a clear invalidation rule.

</details>

<details><summary>8. Is the log database-free?</summary>

There is no database engine or service. The JSONL log is still persistent structured data with its own concurrency, integrity, and migration concerns. Avoid pretending those problems disappear because the storage is a file.

</details>

<details><summary>9. Can the current append lock prevent every race?</summary>

No. It protects a particular read/sign/append critical section. It does not automatically make all earlier application-level checks transactional, and stale-lock recovery has timing assumptions.

</details>

<details><summary>10. What evidence would justify the live harness?</summary>

Observed user sessions where early, understandable alerts prevent unwanted work, without excessive interruptions. Measure useful interventions, false alarms, review/rework effort, and continued use. A working terminal demo alone does not establish that value.

</details>

### Final exercise: teach it back

Without this page, draw the start → stop → outcome path. Explain a baseline exclusion, a streaming duplicate, an unknown money figure, a squash merge, and a truncated log.

For each answer, give **one example, one source function, and one limitation**. If you can do that, you are explaining engineering decisions rather than reciting vocabulary.
