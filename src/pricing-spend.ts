// What a window of sessions cost, and what the money says about where it went. Pure.
import type { Session, SessionOutcome } from "./store.js";
import { formatUsd, priceSession, wasMeasured, type RateTable } from "./pricing.js";

/** What a set of sessions cost, and what could not be answered about them. */
export interface Spend {
  /** Total over the sessions that could be priced. */
  usd: number;
  /**
   * Of that, the sessions whose outcome is anything but merged — bar the empty
   * ones. Open sessions count: work that has not landed has not paid for
   * itself yet, and a figure that only counted the abandoned ones would
   * flatter every week in progress. A session that changed no files is the
   * other way round: it has no unlanded work, so counting it here would
   * inflate the figure with sessions that never had anything to land.
   */
  unmerged: number;
  /**
   * Of the total, what went on sessions that changed no files.
   *
   * Kept apart from `unmerged` rather than folded into it — a session with no
   * changes had nothing to land, so it is not work that failed to ship. It is
   * here because without it a window of nothing but empty sessions has
   * `unmerged: 0`, which reads as "everything shipped" when nothing did.
   */
  empty: number;
  /** How many sessions carried a model no rate covers. */
  unpriced: number;
  /** Which models those were, distinct and sorted, for a message worth acting on. */
  unpricedModels: string[];
  /**
   * How many sessions nothing was captured for — no turns, so no tokens and
   * no model either.
   *
   * Counted apart from `unpriced` because the two absences want different
   * answers from the reader. An unpriced session names a model and is fixed by
   * a rate; this one names nothing, and no rate would fill it — there is
   * nothing on the record to price. Folding them together would put a session
   * with no transcript into a note telling somebody to add a rate for a model
   * called `unknown`.
   */
  uncaptured: number;
}

/**
 * Adds up a window. Unpriced sessions are counted rather than dropped: a total
 * with a silent hole in it is the kind of number people put in invoices.
 */
export function spendOf(sessions: readonly Session[], rates: RateTable): Spend {
  const models = new Set<string>();
  const spend: Spend = {
    usd: 0,
    unmerged: 0,
    empty: 0,
    unpriced: 0,
    unpricedModels: [],
    uncaptured: 0,
  };

  for (const session of sessions) {
    // Asked first, and the same call `sessionFigure` makes for the row: a
    // session with no turns has no model to look up and no tokens to multiply,
    // so it is a hole in the total rather than a nought in it.
    if (!wasMeasured(session.cost)) {
      spend.uncaptured += 1;
      continue;
    }
    const price = priceSession(session.cost, rates);
    if (price.priced) {
      addSpend(spend, price.usd, session.outcome);
    } else {
      spend.unpriced += 1;
      models.add(price.reason ?? (price.model === "" ? "unknown" : price.model));
    }
  }

  spend.unpricedModels = [...models].sort();
  return spend;
}

/**
 * One session's money, into the total and into whichever category it belongs.
 *
 * Everything that did not merge, less what never tried to: a session that
 * changed no files has no changes that failed to land, so its spend is kept
 * apart in `empty` rather than counted as work thrown away. It stays in `usd`
 * either way — it was still spent.
 *
 * Read off `outcome`, which by the time a view calls this holds what the
 * repository says now — see `withOutcomes`.
 */
function addSpend(spend: Spend, usd: number, outcome: SessionOutcome): void {
  spend.usd += usd;
  if (outcome === "empty") {
    spend.empty += usd;
  } else if (outcome !== "merged") {
    spend.unmerged += usd;
  }
}

/**
 * What became of the money, as the clause after "$X spent, ".
 *
 * No money figure for a category with nothing in it. `$0.00 of it on changes
 * that never merged` is a figure the reader has to work out means "none", and
 * a nought printed where a category is simply empty is the same defect as a
 * nought printed where nothing could be priced.
 *
 * "All of it shipped" is only said when every priced dollar is on a session
 * that merged. A window of nothing but sessions that changed no files also
 * has `unmerged: 0` — they had nothing to land — and claiming those shipped
 * would be the overstatement this whole tool exists to avoid. Both counters
 * are exactly zero when no such session contributed, so this never rests on
 * comparing two sums of floats.
 *
 * One function, called by `week` and by the page `week --open` writes, so the
 * terminal and the page cannot come to say different things about one window.
 */
export function shippedNote(spend: Spend): string {
  if (spend.unmerged > 0) {
    return `${formatUsd(spend.unmerged)} of it on changes that never merged`;
  }
  if (spend.empty > 0) {
    // Everything that could land, landed — but not every dollar was on work
    // that could. Said this way round because it is the figure that is nought.
    return "none of it on changes that never merged";
  }
  return "all of it shipped";
}

/**
 * True when the money in a window is not a figure at all.
 *
 * `spendOf` totals the sessions it can price and counts the ones it cannot, so
 * a window where nothing could be priced comes back as `usd: 0` with a count
 * beside it. Rendering that as `$0.00` is the worst kind of wrong: it has the
 * shape of an answer, it goes into somebody's meeting notes or invoice, and it
 * says a week cost nothing when what happened is that nobody knows what it
 * cost. Nought is a claim; unpriced is an absence, and no view may render the
 * first when it means the second.
 *
 * The test is never `usd === 0` alone. A window that genuinely cost nothing —
 * sessions that ran, on models with rates, whose tokens came to nothing —
 * reads `$0.00`, correctly, and that is the case the other clauses protect. A
 * view that got this the other way round would print an em dash over a column
 * of noughts, which is a table that visibly does not add up.
 *
 * Both ways of having no figure count: a model no rate covers, and a session
 * nothing was captured for. They are different absences and the notes under a
 * view name them apart, but neither is a dollar, and a window holding only
 * those has no total to print.
 *
 * It lives here rather than in any one renderer because every view that shows
 * a total obeys it, and three copies of the test are three chances for the
 * views to come to disagree about what a week cost.
 *
 * Takes the fields it reads rather than a whole `Spend`, so `scan` — which
 * totals transcripts nobody recorded and so has no `unmerged` to report — is
 * held to the same rule instead of spelling it out again for itself.
 * `uncaptured` is optional for the same reason: a scanned transcript is a
 * session *because* it has turns in it, so that surface has no such category.
 */
export function unpricedThroughout(
  spend: Pick<Spend, "usd" | "unpriced"> & Partial<Pick<Spend, "uncaptured">>,
): boolean {
  return spend.usd === 0 && (spend.unpriced > 0 || (spend.uncaptured ?? 0) > 0);
}
