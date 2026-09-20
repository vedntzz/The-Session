# How a session flows through the code

One record, four stages: opened, closed against the diff, read back, and
hashed and signed on the way to disk. Every claim below cites the line it came
from. Rationale lives in [decisions.md](decisions.md); this is the trace.

```
┌─ 1 CAPTURE ────────────────────────────────────────────────────────────┐
│ SessionStart ───► session start --passive ───► appendSession           │
│                   startCommit · baseline · attribution · intent = null │
│ UserPromptSubmit ► session intent --from-prompt ───► captureIntent     │
│                   the first prompt, written once, never edited         │
│ (the agent runs; Claude Code writes ~/.claude/projects/**/*.jsonl)     │
└───────────────────────────────────┬────────────────────────────────────┘
┌─ 2 STOP ─ SessionEnd ─► session stop --if-open ────────────────────────┐
│ git diff startCommit ──► changed ──(minus baseline)──► reality         │
│                                     reality ──(scope.ts)──► drift      │
│ adapter ──► transcript.ts: turns cut at user entries, calls folded     │
│             by requestId ──► cost                                      │
│ cost ──(empty.ts, settled against reality)──► emptyTurns               │
│ reality ──(git blob ids)──► endState                                   │
│ ──► updateSession(patch)                                               │
└───────────────────────────────────┬────────────────────────────────────┘
┌─ 4 CHAIN ─ every append goes through writeRecord ──────────────────────┐
│ lock ─► prev = sha256(previous line) ─► hash = sha256(canonical body)  │
│      ─► sig = Ed25519(hash) ─► append one line                         │
│ ~/.session/<sha256(repo identity)[:16]>.jsonl   append-only            │
│ verify: checkChain walks front to back   push: refs/session/<key>      │
└───────────────────────────────────┬────────────────────────────────────┘
┌─ 3 READ ──────────────────────────┴────────────────────────────────────┐
│ readSessions ─► sameRepoLogs ─► foldLogs (creating record + patches)   │
│ ─► withOutcomes (effectiveOutcome, then reportedOutcome)               │
│ ─► formatWeek | renderWeek | renderMarkdownWeek | renderPr             │
│ scan: streams transcripts through the same transcript.ts, writes none  │
└────────────────────────────────────────────────────────────────────────┘
```

## 1 Capture

Three hooks, declared as data: `SessionStart` → `session start --passive`
(`src/capture/hook.ts:77`), `UserPromptSubmit` → `session intent --from-prompt`
(`:95`), `SessionEnd` → `session stop --if-open` (`:57`). With passive capture
off only the last is installed (`:110`).

**The record is created** by `startPassiveSession`, which returns nothing — not
an error — when the directory is no repo or a session is already open
(`src/commands/start.ts:162`). Otherwise `openingFacts` reads the commit to
diff against (`:68`), the files already dirty so `stop` can subtract them
(`:75`), and attribution from `.session.json` (`:80`), and appends with
`intent: null`, `intentSource: "captured"` (`:170`).

**The intent arrives later, once.** `captureFromPrompt` does nothing if no
session is open or one already has words (`src/commands/intent.ts:64`);
`intentFromPrompt` collapses whitespace and cuts at 500 characters (`:38-48`).
`captureIntent` refuses a session that already has an intent
(`src/store/append.ts:198`) and `updateSession` refuses the field outright
(`:237`) — invariant 1, in code.

**The adapter** runs under `captureCost`, which swallows a failing adapter as
zero cost rather than failing the stop (`src/capture/index.ts:18-29`). It looks
under `~/.claude/projects` (`src/capture/adapters/claude-code.ts:16`), keeps
files whose mtime falls in the window (`:71`), reads each whole (`:171`), sorts
entries stably by timestamp (`:106`), and folds them.

**`transcript.ts` normalises** what a line means, for the adapter and `scan`
alike (`src/capture/transcript.ts:1-8`). Four token counters read apart,
because they bill apart (`:47`). A turn is cut at each developer-authored
entry — `type: "user"`, not a sidechain, not meta, not a list of `tool_result`
blocks (`:73`). The label for a prompt is a separate question (`:106`), so
`/clear` starts a turn and is never a label. An unparseable line is skipped,
never thrown (`:145`).

**The requestId dedupe** is `recordCall` returning early when the key is
already present (`:183`): streaming writes one call many times with an
identical usage block. `costOfCalls` then sums the counters, counts distinct
turns and calls, and takes the model that made most of them (`:216-232`).
Nothing here says whether a call wrote a file (`:25-30`).

## 2 Stop

`stopSession` is the sequence (`src/commands/stop.ts:73-93`):

1. **git diff.** `git diff --name-only --no-relative -z` against the resolved
   start commit (`src/git/changes.ts:21`), plus untracked from `ls-files`
   (`:32`).
2. **Baseline subtracted.** `computeReality` drops what was already dirty
   (`src/commands/stop.ts:32-35`). A file touched on top of pre-existing edits
   stays excluded: git reports only that it differs from HEAD, not who wrote
   which hunk.
3. **scope.ts → drift.** `driftOf` returns nothing for a session that declared
   no scope (`:61`) — no declaration, no distance. Otherwise `computeDrift`
   filters through `inScope` (`:41`), and `covers` matches prefixes at
   directory boundaries, so `api/order` never covers `api/orders.py`
   (`src/scope.ts:19-25`).
4. **empty.ts settling.** `reconcileEmpty` runs once, here, where the diff is
   in hand (`src/commands/stop.ts:90`). Files written: `emptySource: "git"` and
   no count, since which turn wrote them is unrecoverable
   (`src/empty.ts:105-106`). Nothing written: every turn was empty, and the
   session's own counters are the empty-turn counters (`:108-118`). Readers go
   through `emptyTurnsOf` (`:43`), never the raw field.
5. **endState blobs.** `endStateOf` records the blob id at each path in
   `reality`, `null` where the file is gone (`src/git/blobs.ts:149-156`). This
   is what `settle` later hunts for in the default branch.
6. **Written to JSONL.** `closingPatch` gathers `reality`, `drift`, `class`,
   `endState`, `cost`, `endedAt` (`src/commands/stop.ts:117-131`), and
   `updateSession` appends it as one patch (`src/store/append.ts:212-226`). The
   creating record is never touched: a session is the fold of its records.

## 3 Read

**store.ts** is a seam over four files (`src/store.ts:4-7`). The log is
`~/.session/<key>.jsonl`, the key being the first 16 hex of SHA-256 over the
repo identity (`src/store/paths.ts:154-170`), which is the origin remote or
else the checkout path (`:102-104`). `readSessions` reads every log belonging
to the repo — one that gained an origin has two — and relabels them under the
current name (`src/store/read.ts:227-229`). `foldLogs` folds all of them in one
pass, so a patch written after the rename still finds its creating record
(`:276-296`); `foldRecord` merges each patch, keeps the original `intent`,
`proposal` and `intentSource` (`:306-309`), and drops a patch whose creating
record is missing (`:311`).

**scan.ts** never writes. Its pure half takes sessions and rates and returns a
report (`src/scan.ts:1-8`); the I/O half streams each transcript a line at a
time rather than holding fourteen megabytes (`src/commands/scan.ts:91-95`),
through the same `parseTranscriptLine`, `recordCall` and `costOfCalls`
(`:127,143,190`). There one transcript is one session, labelled by its first
prompt (`:158`).

**observe.ts** replaces the stored outcome with what the repo says now.
`withOutcomes` gathers facts once for the set (`src/observe.ts:45-52`);
`resolve` runs `effectiveOutcome`, then `reportedOutcome` to decide whether
`abandoned` is a word anybody recorded (`:62-65`). `weekSessions` cuts the
window, resolves outcomes, then filters — filtering on an outcome means
filtering on what is true now (`src/commands/week.ts:155-157`).

**The four renderers** take those same resolved sessions: `formatWeek`,
`renderWeek` and `renderMarkdownWeek` dispatched in one place
(`src/program/week.ts:108,113,116`), and `renderPr` for one session
(`src/render/pr.ts:149`). None calls a model.

## 4 Chain

Every append goes through `writeRecord` (`src/store/append.ts:97-120`). It
takes a lock file created with `wx`, because a chained record is a read then a
write, and two interleaved would give two records the same `prev` (`:46`).
Under the lock it takes `prev = sha256(last line)`, or `GENESIS` for the first
(`:92`, `src/chain.ts:23`), and appends one line.

`signRecord` hashes and signs (`src/store/append.ts:123-139`). The hash covers
the body plus `prev`, serialised with keys sorted recursively so a round trip
through `JSON.parse` reaches the same digest (`src/chain.ts:43-57,83`). The
signature is Ed25519 over the raw bytes of that digest (`src/keys.ts:250`), and
the key's fingerprint sits inside the hash (`src/chain.ts:70-79`).

`checkChain` walks front to back and stops at the first line that does not add
up (`src/verify.ts:99-123`), checking link, signed, body, key claim, signature
in that order — the order in which an edit shows itself (`:164-176`). An empty
log reports as empty, not intact (`:80`). Truncation is the honest limit
(`src/chain.ts:14-17`).

Records travel over git refs and nothing else: one ref per signing key,
`refs/session/<fingerprint>` (`src/sync/refs.ts:42-55`), so two developers
never write the same ref. `pushLog` verifies before anything leaves the machine
and refuses on a break (`src/sync/publish.ts:54-65,89`). `pullPeers` fetches
every key's ref under its own name (`:196`) and merges nothing — peers sit
read-only beside your log (`src/sync/refs.ts:32-36`).

---

Read in this order: `src/store/record.ts` for the shape,
`src/commands/stop.ts` for where most of it is decided, then `src/empty.ts` and
`src/outcome.ts` for the two rules every view reads through.
