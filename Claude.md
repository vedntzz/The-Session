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
  commands/        start.ts stop.ts show.ts week.ts
  capture/         hook.ts, adapters/claude-code.ts
  store.ts         JSONL read/append
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