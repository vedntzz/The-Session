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

A CLI that records AI coding sessions. The developer declares intent before an
agent runs; the tool records what actually happened. The gap between the two is
the product.

$c_pkg

$c_deps

Two runtime dependencies, Node 20 or newer, ESM. No build step beyond `tsc`, no
bundler, no monorepo.

$c_src

$c_test

95 source files at 14,637 lines against 37 test files at 16,440 — more test than
source, which is the intended ratio: *prefer adding a test over adding a log
line*, from Style in `Claude.md`.

## The five invariants

Copied verbatim from `Claude.md`, which owns them — extracted with
`awk '/^## Invariants/,/^## Stack/' Claude.md`. Everything else in this
document is downstream of these.

$v_inv

## The surface

Frozen at twenty verbs. Read from the real `commander` registration tree by
walking `buildProgram().commands` — not from `--help`, which is a filtered view
of it, and not from the Readme, which is prose.

$c_verbs

Twenty top-level verbs; twenty-four rows because `config`, `key` and `hook`
each carry subcommands. `session --help` deliberately lists only `start`,
`week`, `help all` and the bare screen — a decision about what a first reader
can use, not a claim about what exists. `session help all` lists every one, and
is built by walking this same tree, so a command renamed cannot fall off it.

The count is pinned by a test, not only by this document: `test/program.test.ts`
asserts *registers exactly the twenty subcommands* against a sorted list of
names, so a twenty-first fails the suite.

### What 1.0 means

Verbatim from `docs/decisions.md`:

$v_onezero

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

Shipped is the twenty verbs above. Rejected is kept in the repository rather
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

**`prime`** was to propose a scope at `session start` from the repo's own
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

`prime`'s backtest still runs, which is the point of keeping a rejection: the
script vendors the co-change functions that were deleted with the command, so
the measurement can be redone rather than only cited.

$c_bt

The three exact-path figures are the honest column — 6%, 18% and 12%. The two
rolled-up proposals that read 100% did so by claiming almost the whole tree.
Note the tree denominator moves with the tree: `decisions.md` records 142
tracked files, measured before `cochange` was removed, and the same run now
divides by 136.

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

$c_tc

Typecheck covers `tsconfig.json` and `tsconfig.test.json` both; silence is a
pass.

## The other rule files

$c_skills

Each covers one area and is loaded when that area is what is being changed:
`measurement-rules` (outcome, class, intent source, scan, debt, survival,
estimate, money), `sync-and-chain` (the line on disk, verify, refs),
`terminal-output` (CLI surface, colour, Markdown, the pull request body).

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
docs/decisions.md                           what 1.0 means, the rejected list
evidence/verbs.mjs                          the command surface
evidence/extracts.mjs                       how each block above is cut out
```
