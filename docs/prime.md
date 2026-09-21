# Prime

Prime helps choose a scope before a session starts. It copies your intent
verbatim and suggests at most five exact tracked files. It uses no model.

```sh
session prime "add orders rate limiting" --seed src/api/orders.ts
```

The preview reads the checkout and its existing session log. It starts no
session, creates no store, and prints the supporting session ids and how much
of the tracked tree the suggestion covers.

To accept the proposal computed by a new run:

```sh
session prime "add orders rate limiting" --seed src/api/orders.ts --start
```

To replace its scope before starting:

```sh
session prime "add orders rate limiting" --seed src/api/orders.ts --start --scope src/api/orders.ts test/orders.test.ts
```

`--scope` replaces the entire suggestion; it does not append to it. It can name
new files. A preview with no supported suggestion cannot start unless you
supply a scope. `--seed` paths are relative to the repository root, including
when you run from a subdirectory. Seeds must match tracked files; directories
covering more than five files cause an abstention. No arbitrary subset is
chosen from a broad seed. A second invocation recomputes against the checkout
and log as they stand then; it does not accept a cached earlier preview.

## The rule

Named files are retained even without history. Historical suggestions use
closed, unaided declarations in this repository with a nonempty scope. A
declaration must have ended before the question was asked. Captured and primed
sessions cannot train Prime.

A past declaration is comparable when it shares at least two content words
with the intent, or an exactly matching scope entry with a seed. Tokenization
is lowercase ASCII words with a fixed stop-word list in `src/prime.ts`.
This is a wording match, not semantic understanding or a confidence score.

A file must have drifted in at least three comparable declarations and at
least 60% of that comparable set. Later unaided declarations clear earlier
misses. Files missing from the tracked tree are excluded. Named files come
first; historical candidates follow by support count, then path. The total
is capped at five, with omitted candidates counted. Paths never roll up to
their parent directories. Busy files and co-change pairs are not inputs.

Sparse or unrelated history produces an abstention. These conservative
thresholds are an initial rule, not a demonstrated prediction guarantee.

## What is recorded

Starting through Prime records `intentSource: "primed"`, your accepted
`scope`, and the original `proposal`: rule version, intent, suggested scope,
supporting ids and counts, and any abstention. The suggestion stays whole even
if you replace every file. It is immutable and signed as part of the creating
record; old logs are not rewritten or backfilled.
New primed records require a reader that supports Prime; older binaries do
not understand the added intent source.

The intent is still your own text. `primed` distinguishes assisted scope
selection from unaided declarations. Reports mark it with `+`; week and
survival keep its samples apart. `week <id> --full` displays the original proposed
scope alongside the accepted scope. Only the accepted scope participates in
drift and debt. Prime suggestions alone never clear debt.

## Evaluation

```sh
npm run build
node evidence/prime-evaluate.mjs /path/to/repo
```

The evaluation runs the production rule, restricts history to before each
target, and reads that target's tracked tree from its start commit. It reports
precision, recall, abstention, and tree coverage with raw denominators. Seeded
and unseeded results stay separate: giving Prime a previously declared path
is information from the user, not a prediction it earned.

The original rejected rule and backtest remain in `evidence/prime-backtest.mjs`
and the design decisions. This implementation reopens Prime at the user's
request, with no co-change expansion or directory roll-up. Success on this
repository would still require validation on independent repositories.

On this checkout's current history, the first evaluation found 14 eligible
targets and abstained on all 14 unseeded queries. Seeded proposals retained
named files where the five-file bound allowed it. This is evidence that the
workflow works conservatively, not that its historical predictions are useful
yet. Do not market this rule as validated prediction.
