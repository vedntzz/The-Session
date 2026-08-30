# CLAUDE.md

## What this is

`session` — a CLI that records AI coding sessions. The developer declares intent before an agent runs; the tool records what actually happened. The gap between the two is the product.

## Invariants — do not violate these

1. **`intent` is immutable.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation. No `--edit-intent` flag, ever.
2. **No server, no database, no account.** Data lives in JSONL on the user's disk. `sync.ts` moves records over a git remote the team already has, by git talking to git — nothing this project runs is a service, and anything needing one is wrong.
3. **Deterministic only.** File diffs, test exit codes, token counts from the transcript. No LLM is called to judge whether code is good, whether scope was met, or what a session "meant" — nor to write prose about any of it. `session pr` is the standing test of this: a pull request body is exactly where a generated paragraph would be most welcome and most expensive, so it is a transcription of the record and nothing else.
4. **Turns that produced nothing are first-class.** Turns and API calls that changed no files are counted and displayed, never dropped.
5. **Cross-tool.** Nothing may assume Claude Code specifically. Adapters go behind an interface; the core reads a normalised shape.

## Stack

Node 20+, TypeScript, ESM. `commander` for the CLI, `picocolors` for output. Storage is `~/.session/<repo-hash>.jsonl`, one JSON object per line, append-only. No build step beyond `tsc`. No bundler, no monorepo, no Bun.

## Layout

```
src/  cli.ts registration   commands/ start stop show week scan debt cochange survival pr sweep
      verify key config settle estimate intent home   render/ palette.ts (semantic colour)
      terminal.ts html.ts markdown.ts pr.ts (a pull request body, from the record)
      capture/ hook.ts, adapters/claude-code.ts, transcript.ts
      (what a transcript line means — the adapter and scan.ts both read through it)
      store.ts JSONL   outcome.ts merged/abandoned/open   classify.ts path+intent rules
      pricing.ts money   observe.ts repo facts   scan.ts aggregation   git.ts diff, HEAD
      scope.ts what a declared scope covers (stop and debt share the one rule)
      debt.ts paths that keep drifting and were never declared since, per repo
      cochange.ts files that keep changing together, per repo; partnersOf(path)
      survival.ts whether merged work is still there at 14 and 30 days
      commands/sweep.ts settle + due checks, once a day per repo, silent unless written
      chain.ts hashes  keys.ts Ed25519  verify.ts chain walk  sync.ts refs/session/*
      config.ts .session.json, checked in   ../rates.json prices per model, per Mtok
```

## The record

```ts
type Session = {
  id: string; repo: string; startCommit: string
  startedAt: string; endedAt: string | null
  intent: string               // immutable
  intentSource?: IntentSource  // 'declared' | 'captured'; absent reads as declared
  scope: string[]              // declared, may be empty
  baseline: string[]           // dirty at start, subtracted from reality
  reality: string[]            // observed from git diff, less baseline
  drift: string[]              // reality minus scope
  class?: SessionClass         // absent is derived from reality, never guessed
  cost: SessionCost
  outcome: 'open' | 'merged' | 'abandoned' | 'empty'  // what settle/mark last wrote;
                               // views recompute it — never read this one to display
  attribution?: Attribution    // copied from .session.json at start, not patchable
  endState?: Record<string, string | null>  // blob id per reality path at stop, null
                               // = deleted; what makes "did it merge" answerable
  observations?: Observation[] // { outcome, observedAt, commit, branch, source }
  survival?: SurvivalObservation[]  // { window: 14|30, observedAt, commit, branch,
                               // fates: path -> survived|rewritten|deleted }. The one
                               // figure that cannot be recomputed: the branch says what
                               // it holds today, never what it held on day 14
}
// Four counters, never one sum: each bills at a different rate, so a total cannot be
// converted back into money. Turns are prompts; calls are what each one set off.
type TokenCounts = { inputTokens: number; cacheReadTokens: number
                     cacheCreationTokens: number; outputTokens: number }
type SessionCost = TokenCounts & {
  turns: number; emptyTurns: number   // turns that wrote no files
  apiCalls: number; callsWithoutEdits: number  // a call is the fragments sharing a requestId
  model: string                 // the model that did the most calls
  emptyTurnTokens?: TokenCounts // the four counters over the turns that wrote nothing
}
```

## Style

- Small pure functions; side effects only in `commands/` and `store.ts`. Errors state what happened and what to do: `No scope set. Run session start before your agent.`
- No emoji in CLI output — the one exception is the tick in `--md`, which is not CLI output. No spinners. No "Oops!". Colour only through `render/palette.ts`, and only as an addition to output that reads correctly without it — `!` still marks drift where colour cannot.
- Never anthropomorphise the agent — it ran, it changed files, it cost money. Prefer adding a test over adding a log line.

## Don't

- Don't let `session config` grow past attribution: who the work was for is a fact about the repo and the team, so it lives in a checked-in [`.session.json`](docs/decisions.md#who-the-work-was-for) where everyone spells the client the same way. This replaced a flat "no config files" ban, which held until attribution needed a home a team could share — don't read it as licence for a second config. `~/.session/rates.json` holds prices and nothing else. No user-level config, no `--format`, no default flags file.
- Don't build a spec language — scope is a list of path prefixes, matched at directory boundaries.
- Don't add telemetry, a knowledge graph, a web server, or anything to log into. A generated file the user opens or sends is not that.

## The rest

Rules for one area each, loaded when that area is what you are changing: `.claude/skills/measurement-rules` (outcome, class, intent source, scan, debt, co-change, survival, estimate, money), `.claude/skills/sync-and-chain` (the line on disk, verify, refs), `.claude/skills/terminal-output` (CLI surface, colour, Markdown, the pull request body). Why any of it is this way: [docs/decisions.md](docs/decisions.md).
