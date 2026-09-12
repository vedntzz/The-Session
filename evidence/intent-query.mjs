// The falsifiable query the project rests on: do sessions with a **declared**
// intent merge more often than **captured** ones?
//
// Nothing is vendored here. Unlike `prime-backtest.mjs`, which had to freeze a
// copy of removed co-change code to stay runnable, every rule this asks about
// still ships, so every one of them is imported from dist/ — the split on
// `intentSourceOf`, the first-look rule behind the merge rate, the median, the
// empty test, and the whole survival report including its own `bySource` split.
// A query that reimplemented them would be measuring the reimplementation, and
// this one exists to be re-run against the shipped tool.
//
// Scope: the sessions of **this repository**, both logs — the one written
// before it had an origin and the one written after (`readSessions` folds the
// pair; see `sameRepoLogs`). Other repos on this machine are left out for a
// reason that is not tidiness: "did it merge" is a question answered by
// looking at a checkout's default branch, and there is no checkout here to ask
// about a fixture repo or somebody else's remote. Pooling them would mean
// reporting their stored `outcome` field, which is the one thing no view is
// allowed to read.
import { readSessions, intentSourceOf, hasDeclaredScope } from "/Users/vedant/dev-session/dist/store.js";
import { withOutcomes } from "/Users/vedant/dev-session/dist/observe.js";
import { attemptedNothing, isTerminal } from "/Users/vedant/dev-session/dist/outcome.js";
import { firstLook, median, MIN_SESSIONS } from "/Users/vedant/dev-session/dist/estimate/figures.js";
import {
  summarizeSurvival, survivalObservations, SURVIVAL_WINDOWS, SURVIVAL_BENCHMARK,
} from "/Users/vedant/dev-session/dist/survival.js";

const REPO = "/Users/vedant/dev-session";
const SOURCES = ["declared", "captured"];

/** The clock the survival windows are placed against, printed so a re-run
 *  that disagrees can say whether it was the data or the calendar. */
const NOW = Date.now();

const pct = (n, d) => `${((100 * n) / d).toFixed(0)}%`;
/** The group's non-empty sessions, kept so the drift note can re-cut them. */
const worked = (g) => g.sessions;

/**
 * One source's answer. Open and empty sessions are held out of the rate for
 * two different reasons, and both are printed rather than folded away: an open
 * session has not failed to merge, and an empty one did no work to merge.
 */
function group(source, sessions) {
  const mine = sessions.filter((s) => intentSourceOf(s) === source);
  const empty = mine.filter((s) => attemptedNothing(s));
  const worked = mine.filter((s) => !attemptedNothing(s));
  // The first time anybody looked, not where it stands today: a session
  // abandoned and landed a month later merged, but not the first time.
  const looks = worked.map((s) => firstLook(s));
  const decided = looks.filter((o) => isTerminal(o));
  const drifting = worked.filter((s) => hasDeclaredScope(s));
  const merged = decided.filter((o) => o === "merged");
  return {
    source,
    n: mine.length,
    empty: empty.length,
    open: looks.filter((o) => !isTerminal(o)).length,
    decided: decided.length,
    merged: merged.length,
    // Only sessions that declared a scope. `driftOf` records drift as absent
    // for the rest — not as nought — because drift is the distance between a
    // declaration and reality, and there is no distance without a
    // declaration. Taking a median over those zeroes would read as "captured
    // sessions drift less" when what happened is that nobody measured.
    drifting: drifting.length,
    // Source-declared, but the developer named no paths. `hasDeclaredScope`
    // keys off the source, so drift for these is computed against an empty
    // scope and comes back as every file the session touched. They are left
    // in — the shipped rule counts them — and counted here, because a median
    // they are inside of is a different figure from one they are not.
    emptyScope: drifting.filter((s) => s.scope.length === 0).length,
    driftMedian: drifting.length ? median(drifting.map((s) => s.drift.length)) : undefined,
    scopeless: worked.length - drifting.length,
    worked: worked.length,
    sessions: worked,
  };
}

const all = await readSessions({ cwd: REPO });
const resolved = await withOutcomes(all, REPO);
const groups = SOURCES.map((source) => group(source, resolved));

console.log("=".repeat(74));
console.log("declared vs captured intent — merge rate, drift, survival");
console.log(`repo: ${REPO}   sessions on the record: ${resolved.length}`);
console.log(`clock: ${new Date(NOW).toISOString()}   MIN_SESSIONS = ${MIN_SESSIONS}`);
console.log("=".repeat(74));

for (const g of groups) {
  console.log();
  console.log(`${g.source.toUpperCase()}`);
  console.log(`  n                 ${g.n}   (${g.empty} changed no files, held out)`);
  console.log(`  still open        ${g.open}   of the ${g.worked} that changed files`);
  if (g.decided === 0) {
    console.log("  merge rate        no decided session — nothing to take a rate over");
  } else {
    console.log(`  merge rate        ${g.merged}/${g.decided} = ${pct(g.merged, g.decided)}` +
                `   (open excluded from the denominator)`);
  }
  if (g.driftMedian === undefined) {
    console.log(`  median drift      not measurable — none of the ${g.worked} declared a scope,` +
                ` so drift was never defined for any of them`);
  } else {
    console.log(`  median drift      ${g.driftMedian} files   over the ${g.drifting} the` +
                ` shipped rule measures drift for`);
    if (g.emptyScope > 0) {
      const bare = g.drifting - g.emptyScope;
      const rest = median(
        worked(g).filter((s) => hasDeclaredScope(s) && s.scope.length > 0).map((s) => s.drift.length),
      );
      console.log(`                    ! ${g.emptyScope} of those named no paths, so their drift is` +
                  ` their whole reality`);
      console.log(`                      median over the ${bare} that named paths: ` +
                  (bare ? `${rest} files` : "no session to measure"));
    }
  }
  if (g.decided < MIN_SESSIONS) {
    console.log(`  ! under MIN_SESSIONS (${g.decided} < ${MIN_SESSIONS}) — the tool's own views` +
                ` would print the count and withhold the rate`);
  }
}

// ---- what the rates rest on -------------------------------------------
// The decided sessions, one line each. A rate over eight sessions is a claim
// a reader should be able to audit by eye, and at this n the listing is
// shorter than the argument about whether the listing is needed. Transcribed
// from the record, in start order; nothing here is judged.
console.log();
console.log("=".repeat(74));
console.log("THE DECIDED SESSIONS, one line each — the denominators above, in full");
for (const g of groups) {
  console.log();
  console.log(`  ${g.source}`);
  for (const s of g.sessions) {
    const look = firstLook(s);
    if (!isTerminal(look)) continue;
    console.log(`    ${s.startedAt.slice(0, 10)}  ${look.padEnd(9)}` +
                `  ${String(s.reality.length).padStart(3)} files` +
                `  ${hasDeclaredScope(s) ? String(s.drift.length).padStart(3) + " drift" : "  - drift"}` +
                `  ${JSON.stringify(s.intent ?? "(none)").slice(0, 40)}`);
  }
}

// ---- survival ---------------------------------------------------------
// Straight from the shipped report, which already splits by intent source and
// already distinguishes the four reasons a rate can be absent. `missed` is the
// one that matters here: a window that closed unanswered cannot be answered
// later, and printing it as anything but missed would be inventing the figure.
console.log();
console.log("=".repeat(74));
console.log(`SURVIVAL   benchmark ${(100 * SURVIVAL_BENCHMARK).toFixed(0)}% of paths still holding what the session left`);
const report = summarizeSurvival(resolved, NOW);
console.log(`merged sessions in scope: ${report.sessions}` +
            `   of them unsettled (no date to count from): ${report.unsettled}`);
const written = resolved.filter((s) => survivalObservations(s).length > 0).length;
console.log(`sessions with any survival check written down: ${written}`);

for (const w of report.windows) {
  console.log();
  console.log(`  ${w.window}-day window`);
  for (const source of SOURCES) {
    const s = w.bySource[source];
    const line = `    ${source.padEnd(9)} measured ${s.measured}  pending ${s.pending}` +
                 `  due ${s.due}  missed ${s.missed}`;
    if (s.figures) {
      console.log(`${line}  ->  ${pct(s.figures.survived, s.figures.paths)} of ` +
                  `${s.figures.paths} paths survived`);
    } else {
      console.log(`${line}  ->  no rate: ` +
        (s.measured === 0 ? "nothing measured" : `${s.measured} measured, under MIN_SESSIONS`));
    }
  }
}
console.log();
console.log(`SURVIVAL_WINDOWS = ${SURVIVAL_WINDOWS.join(", ")} days`);
