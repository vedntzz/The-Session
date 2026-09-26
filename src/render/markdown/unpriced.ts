// What `week --md` says about the money it could not work out: which sessions, and why each.
import {
  formatUsd,
  priceSession,
  spendOf,
  unpricedThroughout,
  USER_RATES_FILE,
  wasMeasured,
  type RateTable,
  type Spend,
} from "../../pricing.js";
import type { Session } from "../../store.js";
import { plural } from "../terminal/text.js";

/** Where a reader who wants these sessions priced is sent. */
const RATES_HINT = USER_RATES_FILE;

/**
 * The sessions no figure could be put on, split by why.
 *
 * Two different gaps, and they want different things from the reader. A model
 * no rate covers is fixed by a rate. A reason — Codex cache writes whose
 * billing is unverified — is not: no rate fixes it, so a sentence calling it a
 * model with no rate would send somebody to a rates file to add a price for a
 * model called `Codex cache writes: billing unverified`. Read off each
 * session's own `priceSession`, since `Spend` pools the two into one list.
 */
interface Unpriced {
  /** Sessions on a model no rate covers. */
  noRate: number;
  /** Those models, distinct and sorted. */
  models: string[];
  /** Sessions unpriced for a reason no rate would fix, counted per reason, sorted by reason. */
  reasons: [string, number][];
}

function unpricedOf(sessions: readonly Session[], rates: RateTable): Unpriced {
  const models = new Set<string>();
  const reasons = new Map<string, number>();
  let noRate = 0;
  for (const session of sessions) {
    if (!wasMeasured(session.cost)) continue;
    const price = priceSession(session.cost, rates);
    if (price.priced) continue;
    if (price.reason !== undefined) {
      reasons.set(price.reason, (reasons.get(price.reason) ?? 0) + 1);
    } else {
      noRate += 1;
      models.add(price.model === "" ? "unknown" : price.model);
    }
  }
  return { noRate, models: [...models].sort(), reasons: [...reasons].sort(([a], [b]) => a.localeCompare(b)) };
}

/**
 * What the sessions that changed nothing cost.
 *
 * They are not in the table — nothing was attempted, so there is no row of
 * work to write — but the money was spent, and a report that dropped it would
 * be a report whose total is smaller than the bill.
 *
 * Three shapes, for the same reason the headline has two. These sessions are
 * not in `shown`, so `coverageNote` never counts them: this line is the only
 * place the document can admit that some of the bill has no rate behind it,
 * and staying silent would drop the money exactly where it cannot be totalled.
 * A clause omitted because nothing was spent and a clause omitted because
 * nothing could be priced would read the same, which is the confusion this
 * whole rule exists to prevent.
 */
export function emptyNote(empties: readonly Session[], rates: RateTable): string | undefined {
  if (empties.length === 0) {
    return undefined;
  }
  const cost = emptyCost(spendOf(empties, rates), unpricedOf(empties, rates));
  return (
    `${plural(empties.length, "session", "sessions")} changed no files and ` +
    `${empties.length === 1 ? "is" : "are"} not in the table${cost}.`
  );
}

/**
 * What that money was, where there is a figure for it at all.
 *
 * Three ways to have none, and each says which. A model with no rate names the
 * model; a reason no rate would fix names the reason, never as a model; a
 * session with nothing captured names no model, because there is no model on
 * the record to name — a clause reading `an amount no rate covers ()` would be
 * this document admitting a gap and then failing to say what it was. A window
 * that simply cost nothing says nothing, since the sentence above it has
 * already said these sessions are not in the table.
 */
function emptyCost(spend: Spend, unpriced: Unpriced): string {
  if (unpricedThroughout(spend)) {
    if (spend.unpriced === 0) {
      return ", and nothing was captured to say what they cost";
    }
    const amounts = [
      ...(unpriced.noRate > 0 ? [`an amount no rate covers (${unpriced.models.join(", ")})`] : []),
      ...(unpriced.reasons.length > 0
        ? [`an amount that could not be priced (${unpriced.reasons.map(([reason]) => reason).join(", ")})`]
        : []),
    ];
    return `, costing ${amounts.join(" and ")}`;
  }
  return spend.usd > 0 ? `, costing ${formatUsd(spend.usd)}` : "";
}

/**
 * How much of the table the money covers, and what it leaves out.
 *
 * Said outright rather than folded in. The figure below is a total over the
 * sessions that could be priced, and a total with a silent hole in it is the
 * kind of number that ends up in an invoice — the whole reason `pricing.ts`
 * refuses to guess a rate.
 *
 * Every hole is named, and named apart. A missing rate is somebody's next
 * five minutes; a reason no rate fixes and a session with nothing captured are
 * not, and pointing that reader at a rates file would be pointing them at a
 * fix for a different problem. Between them they account for every cell in
 * the column that is not a figure.
 *
 * "Below", because the money is the closing line. The count is dropped where
 * nothing could be priced at all: "the cost below covers 0 of 2 sessions"
 * points at a figure the document deliberately did not print, and the closing
 * line already says so itself.
 */
export function coverageNote(shown: readonly Session[], rates: RateTable, spend: Spend): string | undefined {
  const missing = spend.unpriced + spend.uncaptured;
  if (missing === 0) {
    return undefined;
  }

  const unpriced = unpricedOf(shown, rates);
  const parts: string[] = [];

  if (!unpricedThroughout(spend)) {
    parts.push(`The cost below covers ${shown.length - missing} of ${shown.length} sessions.`);
  }
  if (unpriced.noRate > 0) {
    parts.push(
      `${plural(unpriced.noRate, "session", "sessions")} ran on a model with no rate (${unpriced.models.join(", ")}).`,
    );
    if (unpricedThroughout(spend)) {
      parts.push(`Add one to ${RATES_HINT}.`);
    }
  }
  for (const [reason, count] of unpriced.reasons) {
    parts.push(`${plural(count, "session", "sessions")} could not be priced (${reason}).`);
  }
  if (spend.uncaptured > 0) {
    parts.push(
      `${plural(spend.uncaptured, "session", "sessions")} had no turns on the record, ` +
        "so nothing was captured to price.",
    );
  }

  return parts.join(" ");
}
