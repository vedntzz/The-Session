# AGENTS.md

## What this is

`session` — a CLI that records AI coding sessions. The developer declares intent before an agent runs; the tool records what actually happened. The gap between the two is the product.

## Invariants — do not violate these

1. **`intent` is immutable, and so are the accepted terms.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation. No `--edit-intent` flag, ever. The same holds for `agreement`, `proposal` and `checkout`: signed into the creating record, never patched, never added to a session that began without them, never backfilled onto an old one.
2. **Source code, prompts and transcripts never leave the machine.** Data lives in JSONL on the user's disk. `sync.ts` moves records over a git remote the team already has, by git talking to git — nothing this project runs is a service. The tool itself needs no account, reaches no network but that remote, and sends nothing. An [optional hosted team layer](docs/decisions.md#what-never-leaves-the-machine) may take metadata only — paths, counts, decisions, outcomes, costs — and does not exist yet, so anything in this repo reaching for one is wrong. Content never crosses, under any flag.
3. **Deterministic only.** File diffs, test exit codes, token counts from the transcript. No LLM is called to judge whether code is good, whether scope was met, or what a session "meant" — nor to write prose about any of it. `session pr` is the standing test of this: a pull request body is exactly where a generated paragraph would be most welcome and most expensive, so it is a transcription of the record and nothing else. A model may *propose* — a scope, an agreement — for the developer to accept, edit or reject before the work; the proposal records its proposer (`prime` or `external`; older proposals without the field read as `prime` through `proposerOf`, their bytes untouched) and is recorded apart from what was accepted, as Prime's is, and only what was accepted is ever measured against. This tool never calls a model. [Models propose, never judge](docs/decisions.md#the-v1-boundary).
4. **Turns that produced nothing are first-class.** Turns that changed no files are counted and displayed, never dropped — and where the record cannot say which turns those were, *that* is displayed rather than a nought. A transcript names the tool a call used, never what it did to the disk, so the question goes to git: `empty.ts` is the one rule, and no view reads `cost.emptyTurns` itself.
5. **Cross-tool.** Nothing may assume a specific coding tool. Adapters go behind an interface; the core reads a normalised shape.
6. **The write check never grants.** `session hook check` answers `ask` or `deny`, or prints nothing and leaves the editor's own permissions in charge — never `allow`, never the host's literal `defer`, never rewritten tool input. A failure it can catch is a denial, not a guess, and no response echoes source content, paths or a raw error. The payload never chooses the repository; the process cwd does.

## Stack

Node 20+, TypeScript, ESM. `commander` for the CLI, `picocolors` for output. Storage is `~/.session/<repo-hash>.jsonl`, one JSON object per line, append-only. No build step beyond `tsc`. No bundler, no monorepo, no Bun.

## Layout

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
../evidence/prime-evaluate.mjs production Prime rule, walk-forward evaluation
```

## The record

```ts
type Session = {
  id: string; repo: string; startCommit: string
  startedAt: string; endedAt: string | null
  intent: string | null        // immutable; null until a passive session's first prompt
  intentSource?: IntentSource  // 'declared' | 'primed' | 'captured'; absent reads as declared
  proposal?: PrimeProposal    // present exactly for primed; original suggestion,
                               // immutable and signed at start, even if scope is replaced;
                               // proposer?: 'prime' | 'external', absent reads as prime
  agreement?: Agreement        // { paths, actions: create|edit|delete, sensitivePaths,
                               // policy: record|ask|deny }; only in the creating record,
                               // absent means none was recorded — never default terms
  checkout?: string            // canonical checkout root from git + realpath at creation;
                               // absent when git could not say, never guessed or backfilled
  scope: string[]              // accepted scope, may be empty; separate from proposal;
                               // equals agreement.paths and is fixed when one exists
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
  turns: number; emptyTurns?: number  // turns that wrote no files; absent = the
                                // record cannot say, which is every session that
                                // changed files. Read it through empty.ts, never raw
  apiCalls: number; callsWithoutEdits?: number  // a call is the fragments sharing a
                                // requestId. The second is never written or shown
                                // again: no transcript can say what a call wrote
  model: string                 // the model that did the most calls
  emptyTurnTokens?: TokenCounts // the four counters over the turns that wrote nothing
  emptySource?: EmptySource     // 'git' | 'tools'; absent reads as tools, the old
                                // rule that called a turn empty when it named no
                                // Edit/Write tool — wrong for anything using a shell
}
```

## Style

- Small pure functions; side effects only in `commands/` and `store.ts`. Errors state what happened and what to do: `No scope set. Run session start before your agent.`
- No emoji in CLI output — the one exception is the tick in `--md`, which is not CLI output. No spinners. No "Oops!". Colour only through `render/palette.ts`, and only as an addition to output that reads correctly without it — `!` still marks drift where colour cannot.
- Never anthropomorphise the agent — it ran, it changed files, it cost money. Prefer adding a test over adding a log line.

## Don't

- Don't let `session config` grow past attribution: who the work was for is a fact about the repo and the team, so it lives in a checked-in [`.session.json`](docs/decisions.md#who-the-work-was-for) where everyone spells the client the same way. This replaced a flat "no config files" ban, which held until attribution needed a home a team could share — don't read it as licence for a second config. `~/.session/rates.json` holds prices and nothing else. No user-level config, no `--format`, no default flags file.
- Don't build a spec language — scope is a list of path prefixes, matched at directory boundaries.
- Don't make the CLI phone home, and don't add a web server or anything to log into. Invariant 2 permits a team layer that receives metadata; it does not permit this tool to acquire an account, a network dependency, or a second database. `session knowledge` is a read-only graph and compact context export derived from existing records, never a second database, an inferred dependency graph, or an LLM summary. A generated file the user opens or sends is not a service.
- Don't add a command for a second view of something another already shows, or one that measures anything other than the distance between a declaration and a diff. The freeze is retired; [the v1 boundary](docs/decisions.md#the-v1-boundary) replaced it. `show` is `week <id>`, `debt` is in `prime`, and `estimate` is gone.

## The rest

Rules for one area each, loaded when that area is what you are changing: `.agents/skills/measurement-rules` (outcome, class, intent source, scan, debt, survival, Prime, money), `.agents/skills/sync-and-chain` (the line on disk, verify, refs), `.agents/skills/terminal-output` (CLI surface, colour, Markdown, Prime's preview, the pull request body, the review screen), `.agents/skills/agreements-and-enforcement` (accepted terms, the write decision, payload parsing, path resolution, `session hook check`). Why any of it is this way: [docs/decisions.md](docs/decisions.md); the agreement contract in full: [docs/agreements.md](docs/agreements.md).

## Working in this repo

One milestone at a time: implement it, test it, write the handoff in `claudehand off/README.md` (archiving the previous one as a numbered file beside it), then stop. Vedant reviews, stages, commits and pushes — an agent never does, and never starts the next milestone unasked. A handoff reports what was actually run: which tests, how many passed, what failed and how it was fixed. A targeted run is not called a full-suite run.
