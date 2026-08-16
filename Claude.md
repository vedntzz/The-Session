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
  commands/        start.ts stop.ts show.ts week.ts verify.ts key.ts
  capture/         hook.ts, adapters/claude-code.ts
  store.ts         JSONL read/append
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
  cost: SessionCost
  outcome: 'open' | 'merged' | 'abandoned'
  startedAt: string
  endedAt: string | null
  startCommit: string
}

type SessionCost = {
  // Four counters, never one sum: each bills at a different rate, so a total
  // cannot be converted back into money.
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number

  // Turns are prompts; calls are what each prompt set off. Both are kept:
  // turns are the honest unit for "how much of this produced nothing",
  // calls are what the transcript measures directly.
  turns: number
  emptyTurns: number             // turns that wrote no files
  apiCalls: number               // streaming fragments collapsed by requestId
  callsWithoutEdits: number

  model: string                  // the model that did the most calls
}
```

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

- Don't add config files or a `session config` command in v1.
- Don't build a spec language. Scope is a list of path prefixes, matched at directory boundaries.
- Don't add telemetry of any kind.
- Don't add a knowledge graph, a web server, or a dashboard. Those are week-two questions.