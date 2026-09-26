# AGENTS.md

## What this is

`session` is the system of record for agent work. The developer declares intent — and, if they want, accepted terms — before an agent runs; the tool records what actually changed, whether it landed, and what it cost, signed, on the developer's own disk. The gap between the declaration and the diff is the product.

## Invariants — do not violate these

1. **`intent` is immutable, and so are the accepted terms.** Written once at `session start`, never edited afterward. A declaration you can revise after seeing the result is a rationalisation. No `--edit-intent` flag, ever. The same holds for `agreement`, `proposal` and `checkout`: signed into the creating record, never patched, never added to a session that began without them, never backfilled onto an old one.
2. **Source code, prompts and transcripts never leave the machine.** Data lives in JSONL on the user's disk. `sync.ts` moves records over a git remote the team already has, by git talking to git — nothing this project runs is a service. The tool itself needs no account, reaches no network but that remote, and sends nothing. An [optional hosted team layer](docs/decisions.md#what-never-leaves-the-machine) may take metadata only — paths, counts, decisions, outcomes, costs — and does not exist yet, so anything in this repo reaching for one is wrong. Content never crosses, under any flag.
3. **Deterministic only.** File diffs, test exit codes, token counts from the transcript. No LLM is called to judge whether code is good, whether scope was met, or what a session "meant" — nor to write prose about any of it. `session pr` is the standing test of this: a pull request body is exactly where a generated paragraph would be most welcome and most expensive, so it is a transcription of the record and nothing else. A model may *propose* — a scope, an agreement — for the developer to accept, edit or reject before the work; the proposal records its proposer (`prime` or `external`; older proposals without the field read as `prime` through `proposerOf`, their bytes untouched) and is recorded apart from what was accepted, as Prime's is, and only what was accepted is ever measured against. An optional advisor (Jev, src/jev/) may be called when JEV_API_KEY and an https JEV_ENDPOINT are set; off by default. It may propose a scope, label a write for the developer, or tag a task. It never decides: no allow/ask/deny, no drift, outcome, class or measured figure comes from it. Only intent text and repo-relative paths leave the machine. [Models propose, never judge](docs/decisions.md#the-v1-boundary).
4. **Turns that produced nothing are first-class.** Turns that changed no files are counted and displayed, never dropped — and where the record cannot say which turns those were, *that* is displayed rather than a nought. A transcript names the tool a call used, never what it did to the disk, so the question goes to git: `empty.ts` is the one rule, and no view reads `cost.emptyTurns` itself.
5. **Cross-tool.** Nothing may assume a specific coding tool. Adapters go behind an interface; the core reads a normalised shape.
6. **The write check never grants.** `session hook check` answers `ask` or `deny`, or prints nothing and leaves the editor's own permissions in charge — never `allow`, never the host's literal `defer`, never rewritten tool input. A failure it can catch is a denial, not a guess, and no response echoes source content, paths or a raw error. The payload never chooses the repository; the process cwd does.

## Stack

Node 20+, TypeScript, ESM. `commander` and `picocolors` are the only runtime dependencies. `tsc` only — no bundler, no monorepo, no Bun. The log is `~/.session/<repo-key>.jsonl` (`$SESSION_HOME` overrides), one signed JSON object per line, append-only. Unsigned working files live in `~/.session/tmp/` and are never evidence.

## Layout

```
src/ cli.ts, program/*.ts registration; commands/*.ts do the work; everything else is pure
  store/ record.ts types · append.ts locked, signed writer · read.ts fold · paths.ts · scratch.ts tmp
  chain.ts keys.ts verify.ts sync.ts   hash chain, Ed25519, verify, refs/session/*
  git/ run.ts changes.ts blobs.ts (treeStateSince, treeStateCached) branch.ts
  capture/ hook.ts settings surgery · transcript.ts · adapters/ claude-code, claude-write, claude-bash, codex, codex-rollout, files
  scope.ts classify.ts outcome.ts observe.ts empty.ts pricing.ts pricing-turns.ts survival.ts debt.ts prime.ts scan.ts
  agreement.ts agreement-decision.ts write-session.ts   accepted terms, defer/ask/deny, one session per checkout
  commands/check-write.ts resolve-{write,shell,move,copy,remove}.ts   session hook check
  write-check-event.ts write-checks.ts commands/record-write-check.ts capture/check-adapter.ts   its signed events
  shell/ words.ts (zsh-safe) package-manager sed redirect tee move copy remove read-only
  tree-state.ts tool-calls.ts commands/tool-call.ts   per-call records — built, not wired to a hook
  render/ palette.ts (the only colour) terminal/ markdown.ts html.ts pr.ts agreement.ts tui/
evidence/ gen-context.mjs (docs/context.md) prime-evaluate.mjs enforce-e2e.mjs
```

## The record

`Session` in `src/store/record.ts` is the whole shape; `docs/context.md` carries it verbatim. The fields a change must know:

```ts
  intent: string | null        // fixed; a passive session's arrives once, from its first prompt
  intentSource?: IntentSource  // 'declared' | 'primed' | 'captured'; absent reads as declared
  agreement?, proposal?, checkout?, baselineState?, attribution?  // creating record only, never patched
  reality: string[]            // diff vs startCommit, less baseline, plus baseline paths whose blob moved
  drift: string[]              // reality outside scope
  outcome                      // what settle/mark last wrote; views recompute it
  toolCalls?: ToolCall[]       // folded from signed {callId, n, tool} start/end events; changed null = unattributed
  cost: SessionCost            // four token counters, never one sum; empty turns via empty.ts only
```

## Style

- Small pure functions; side effects in `commands/` and `store/`. Errors say what happened, then what to do.
- No emoji in CLI output (the `--md` tick excepted), no spinners. Colour only through `render/palette.ts`, and output must read correctly without it.
- Never anthropomorphise the agent. Prefer a test to a log line. Unknown is never rendered as nought.

## Don't

- Grow `session config` past attribution, or add any other config file. `~/.session/rates.json` holds prices only.
- Build a spec language: scope is path prefixes at directory boundaries.
- Phone home, run a server, or add an account. Generated files the user opens are not a service.
- Add a command for a second view of what another shows (see [the v1 boundary](docs/decisions.md#the-v1-boundary)).
- Emit `allow` from the check, or let an unrecognised shell command read as "writes nothing".

## The rest

Load the skill for the area you change: `.agents/skills/measurement-rules` (outcome, class, source, scan, debt, survival, Prime, money, reality, per-call snapshots), `sync-and-chain` (the line on disk, scratch, verify, refs), `terminal-output` (what a person reads), `agreements-and-enforcement` (terms, the write check, shell recognition). Why: [docs/decisions.md](docs/decisions.md). Contract: [docs/agreements.md](docs/agreements.md). Plan and current state: [docs/context.md](docs/context.md).

## Working in this repo

One milestone at a time: implement, test, stop. Vedant reviews, stages, commits and pushes — an agent never does, and never starts the next milestone unasked. Report what was actually run: which tests, how many passed, what failed. A targeted run is not a full-suite run. Handoff notes in `claudehand off/` are local and untracked.
