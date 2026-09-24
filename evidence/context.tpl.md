# Context

What `session` is, as the repository actually stands.

Every figure below is followed by the command that produced it and that
command's real output. Nothing here is typed from memory and nothing is
summarised from a conversation: a number that has gone stale can be caught by
running the line printed above it.

Derived at `$head` (`$describe`).

This replaced a summary that lived only in a chat log and was three releases
out of date before anyone noticed. The rule that follows from that: **this file
is re-derived, not edited.** The invariants, the measurement rules, the record
shape and the command list are copied out of the files that own them, and each
section names its source, so regenerating beats amending.

| what | lives in |
|---|---|
| Invariants | [`Claude.md`](../Claude.md) |
| Measurement rules | [`.claude/skills/measurement-rules/SKILL.md`](../.claude/skills/measurement-rules/SKILL.md) |
| The record | [`src/store/record.ts`](../src/store/record.ts) |
| The command surface | the `commander` tree, via [`evidence/verbs.mjs`](../evidence/verbs.mjs) |
| Why any of it is this way | [`docs/decisions.md`](decisions.md) |

---

## What it is

The system of record for agent work. A CLI: the developer declares intent —
and, optionally, accepted terms — before an agent runs; the tool records what
actually changed, whether it landed and what it cost, signed, on the
developer's own disk. The gap between the declaration and the diff is the
product.

$c_pkg

$c_deps

Two runtime dependencies, Node 20 or newer, ESM. No build step beyond `tsc`, no
bundler, no monorepo.

$c_src

$c_test

The commands above count the source and tests currently in the checkout.
The intended practice is *prefer adding a test over adding a log line*, from
Style in `Claude.md`.

## The six invariants

Copied verbatim from `Claude.md`, which owns them — extracted with
`awk '/^## Invariants/,/^## Stack/' Claude.md`. Everything else in this
document is downstream of these.

$v_inv

## The surface

The v1 surface, after `estimate` was cut, `show` became `week <id>` and `debt` became `prime --debt`. Read from the real `commander` registration tree by
walking `buildProgram().commands` — not from `--help`, which is a filtered view
of it, and not from the Readme, which is prose.

$c_verbs

The command above counts top-level verbs and subcommands. `session --help` deliberately lists only `start`,
`week`, `help all` and the bare screen — a decision about what a first reader
can use, not a claim about what exists. `session help all` lists every one, and
is built by walking this same tree, so a command renamed cannot fall off it.

The count is pinned by a test, not only by this document: `test/program.test.ts`
asserts the v1 command set against a sorted list of names.

### The v1 boundary

Verbatim from `docs/decisions.md`:

$v_boundary

## What has shipped since the v1 boundary

From the code and `git log`, 21–23 September 2026:

| Area | What exists | Where |
|---|---|---|
| Agreement record | Terms (paths, actions, sensitive paths, policy) signed into the first record, never patched | `src/agreement.ts`, `src/store/` |
| Review screen | `start --review`, `prime --start --review`; only `accept` saves | `src/commands/review.ts` |
| Write check | `session hook check`: `ask`/`deny` or silence, never `allow`, for Edit, Write, MultiEdit and Bash | `src/commands/check-write.ts`, `src/agreement-decision.ts` |
| Shell recognisers | npm/pnpm/yarn, `sed -i`, `>`, `tee`, `mv`, `cp`, `rm`, read-only list; unknown → ask "Can't tell what this writes." | `src/shell/`, `src/commands/resolve-shell.ts` |
| Install | `session hook install --repo` / `--repo --uninstall`, this repository's `.claude/settings.local.json` only | `src/commands/hook.ts`, `src/capture/hook.ts` |
| Start snapshot | Blob per dirty file at start; `stop` counts dirty files the session changed again | `src/commands/start.ts`, `src/commands/stop.ts` |
| Per-call records | Signed `{callId, n, tool}` start and end events; unsigned before-state scratch; incremental snapshot with the racily-clean rule. **Not wired to a hook** | `src/tool-calls.ts`, `src/commands/tool-call.ts`, `src/store/scratch.ts`, `src/git/blobs.ts` |

### How the write check fails

Fail-closed for what the check can catch, fail-open for what the host decides:

- A malformed or oversized payload, an unreadable log, a blocked path: JSON
  `deny` (`src/commands/check-write.ts`, the `catch` in `evaluate`).
- Its own deadline: `deny` at `CHECK_DEADLINE_MS`, 5 s
  (`src/commands/check-write.ts`).
- An error that escapes the check: exit 2, which blocks (`src/program/hook.ts`).
- The host's timeout (10 s, `CHECK_HOOK` in `src/capture/hook.ts`), a crash
  with no JSON, or `session` missing from the editor's `PATH`: Claude Code lets
  the write through. Nothing in this repository sets that.
- A `record` policy never blocks; an unrecognised shell command is `ask`.

## The plan

The three-screen prototype was dropped on 21 September. Per-call diff wiring
is parked until a warm hook is under 100 ms (it is about 200 ms; the cost is
git spawns) — see [the parking lot](parking-lot.md).

**Sprint 2, 24 September – 2 October:** the contract; signed write-check
events; a Codex adapter; a session agents view; the walkthrough; dogfooding
under both agents.

**Sprint 3, 3–9 October:** Jev, on branch `feat/jev`, built outside this
repository's tooling, merged only if its backtest beats the 6–18% baseline;
then the install flow and README.

## The record

One JSON object per line, append-only, hash-chained and signed.

$c_home

$c_refs

$c_attr

Storage is `$$SESSION_HOME`, else `~/.session/<repo-hash>.jsonl`. Records move
between machines over `refs/session/<fingerprint>` and nothing else — git
talking to git, per invariant 2. Attribution lives in a checked-in
`.session.json` and is the only thing `session config` may ever hold.

Verbatim from `src/store/record.ts`:

```ts
$v_iface
```

## Measurement rules

What the tool is allowed to claim it measured, and how each figure is arrived
at. Copied verbatim from the skill that owns them, headings demoted one level
to nest here and its relative links repointed at this directory.

$c_skhead

That file is the copy a change is held to. **If the two ever disagree, the
skill wins and this section is stale** — regenerate rather than edit here.

$v_skill

## Shipped, and rejected

The implemented surface is listed above. Rejected designs are kept in the repository rather
than dropped, because the measurement is the useful part: a reader deciding
whether to try one of these again starts from what already failed.

$c_rej

**`cochange`** was built, shipped, and cut before 1.0. It counted, per pair of
paths, the sessions that changed both over the sessions that changed the
commoner of the two. It read `reality` alone, so no declaration entered the
arithmetic and nothing it printed could be a planning failure — what it ranked
was which files are central. `debt` reads `drift`, which is `reality` less what
was declared, and that subtraction was the only real difference between the two
reports. Its one consumer was `prime`; once `prime` went, `partnersOf` was
called by nothing but its own tests.

**The original `prime` rule** was to propose a scope at `session start` from the repo's own
co-change and drift history. It was measured against this repo's real log and
never shipped: exact-path hit rates of 6%, 18% and 12% across three sessions,
and the two rolled-up proposals that scored 100% did so by claiming 139 of 142
tracked files. A scope covering the repository cannot produce drift, because
there is nothing left outside it to drift onto.

Both entries carry their full reasoning in
[`docs/decisions.md`](decisions.md#rejected), and `prime`'s carries its backtest
table. Two sections of the record's design that were settled before `prime` was
measured are kept under `Superseded` banners rather than deleted, because an
append-only log cannot be backfilled and those questions had to be answered
while a session could still be opened under them.

The old backtest is retained and requires the original target sessions.
The current implementation uses exact files and comparable declarations'
drift, with no co-change or roll-up. It can abstain and records accepted
scopes separately from the original suggestion. See [Prime](prime.md) for
the workflow, limits, and current evaluation. Run
`node evidence/prime-evaluate.mjs` after building to evaluate the production
rule against the history on this machine.

## Layout

Verbatim from `Claude.md`:

$v_layout

## Prices

$c_rates

Prices are data, not code: `rates.json` beside the package, merged entry by
entry with `~/.session/rates.json` if there is one. A model in neither is
reported unpriced, with its tokens and its name — never priced at the nearest
model's rate. A release of this tool is not a price update.

## Tests

$c_tests

The generator runs the behavioral suite before writing this document, then
checks `test/context.test.ts` against the newly written text. It excludes that
self-check from the earlier run to avoid testing the stale document it is
replacing.

$c_tc

Typecheck covers `tsconfig.json` and `tsconfig.test.json` both; silence is a
pass.

## The other rule files

$c_skills

Each covers one area and is loaded when that area is what is being changed:
`measurement-rules` (outcome, class, intent source, scan, debt, survival,
Prime, money, reality, per-call snapshots), `sync-and-chain` (the line on
disk, unsigned scratch, verify, refs), `terminal-output` (CLI surface, colour,
Markdown, the pull request body, the review screen), `agreements-and-enforcement`
(terms, the write check, shell recognition).

## Regenerating this file

This document is derived, not edited. Every console block above is the real
output of the command printed with it, and the prose blocks are copied out of
the files that own them.

```
node evidence/gen-context.mjs
```

`test/context.test.ts` fails when a copied block no longer matches its source,
which is the signal to run that again. The five sources, and the one extraction
rule both the generator and the test read them through:

```
Claude.md                                   invariants, layout
.claude/skills/measurement-rules/SKILL.md   measurement rules
src/store/record.ts                         interface Session
docs/decisions.md                           the v1 boundary, the rejected list
evidence/verbs.mjs                          the command surface
evidence/extracts.mjs                       how each block above is cut out
```
