import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Session, SessionCost, SessionOutcome, TokenCounts } from "./store.js";

/**
 * What a session cost in money.
 *
 * The four token counters bill at four different rates, which is why the record
 * never collapses them into one figure: a total cannot be turned back into
 * dollars. This is where they are turned into dollars, and it is the only place
 * that knows a price.
 *
 * Prices are data, not code. They live in `rates.json` beside the package and
 * in `~/.session/rates.json` if you keep your own, so a rate change is an edit
 * to a file rather than a release. A model in neither is reported as unpriced —
 * never priced at whatever the nearest model costs, because a guessed rate on
 * an invoice is worse than an admitted gap.
 */

/** Rates for one model, in USD per million tokens. */
export interface ModelRate {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

/** Model name to its rates. Keyed as written in the file. */
export type RateTable = ReadonlyMap<string, ModelRate>;

/** Rates are quoted per million tokens, which is how vendors publish them. */
const PER = 1_000_000;

// --- pricing, pure -------------------------------------------------------

/** What a set of token counters costs at one model's rates. */
export function priceTokens(tokens: TokenCounts, rate: ModelRate): number {
  return (
    (tokens.inputTokens * rate.input +
      tokens.cacheReadTokens * rate.cacheRead +
      tokens.cacheCreationTokens * rate.cacheCreation +
      tokens.outputTokens * rate.output) /
    PER
  );
}

/**
 * The rates entry that covers a model.
 *
 * Exactly, or by the longest key that is a prefix of it at a dash: transcripts
 * report dated ids like `claude-sonnet-4-5-20250929`, and a table that had to
 * list every snapshot would be stale the week it shipped. The dash matters —
 * without it `claude-opus-4` would price `claude-opus-45`, a model nobody has
 * quoted a price for.
 */
export function rateFor(
  model: string,
  rates: RateTable,
): { key: string; rate: ModelRate } | undefined {
  const exact = rates.get(model);
  if (exact) {
    return { key: model, rate: exact };
  }

  let best: { key: string; rate: ModelRate } | undefined;
  for (const [key, rate] of rates) {
    if (model.startsWith(`${key}-`) && (best === undefined || key.length > best.key.length)) {
      best = { key, rate };
    }
  }
  return best;
}

/** What a session cost, or which model stopped it being answerable. */
export type Price =
  | {
      priced: true;
      /** The model as the transcript reported it. */
      model: string;
      /** The rates key that covered it, which may be a shorter prefix. */
      matched: string;
      usd: number;
      /**
       * The part of `usd` spent on turns that changed no files. Undefined on a
       * session captured before that was recorded — an estimate from the turn
       * count would be a number nobody measured.
       *
       * **Never print this without asking `emptyTokensOf` first.** It is
       * priced straight off `cost.emptyTurnTokens`, which is the raw field,
       * and the raw field is exactly what `empty.ts` exists to stand in front
       * of: a record written under the old `tools` rule can carry a whole
       * session's tokens here while having changed files, a figure git refutes
       * and `emptyTurnsOf` refuses. `wasteCell` guards, which is why nothing
       * wrong is shown today. A second caller that reads this field and prints
       * it resurrects the refuted figure — see invariant 4.
       */
      emptyUsd?: number;
    }
  | { priced: false; model: string };

export function isPriced(price: Price): price is Extract<Price, { priced: true }> {
  return price.priced;
}

/** What a session cost. Unpriced when no entry covers the model it ran on. */
export function priceSession(cost: SessionCost, rates: RateTable): Price {
  const found = rateFor(cost.model, rates);
  if (!found) {
    return { priced: false, model: cost.model };
  }

  return {
    priced: true,
    model: cost.model,
    matched: found.key,
    usd: priceTokens(cost, found.rate),
    ...(cost.emptyTurnTokens
      ? { emptyUsd: priceTokens(cost.emptyTurnTokens, found.rate) }
      : {}),
  };
}

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
}

/**
 * Adds up a window. Unpriced sessions are counted rather than dropped: a total
 * with a silent hole in it is the kind of number people put in invoices.
 */
export function spendOf(sessions: readonly Session[], rates: RateTable): Spend {
  const models = new Set<string>();
  const spend: Spend = { usd: 0, unmerged: 0, empty: 0, unpriced: 0, unpricedModels: [] };

  for (const session of sessions) {
    const price = priceSession(session.cost, rates);
    if (price.priced) {
      addSpend(spend, price.usd, session.outcome);
    } else if (wasMeasured(session.cost)) {
      // A session that spent nothing at all needs no rate, and reporting it as
      // unpriced would be reporting a gap that costs nobody anything. The same
      // call `sessionFigure` makes for the row, from the same function.
      spend.unpriced += 1;
      models.add(session.cost.model === "" ? "unknown" : session.cost.model);
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
 * The test is both halves, never `usd === 0` alone. A window that genuinely
 * cost nothing — nothing captured, so no rate is missing — reads `$0.00`,
 * correctly, and that is the case the second half protects. A view that got
 * this the other way round would print an em dash over a column of noughts,
 * which is a table that visibly does not add up.
 *
 * It lives here rather than in any one renderer because every view that shows
 * a total obeys it, and three copies of a two-clause test are three chances
 * for the views to come to disagree about what a week cost.
 *
 * Takes the two fields it reads rather than a whole `Spend`, so `scan` — which
 * totals transcripts nobody recorded and so has no `unmerged` to report — is
 * held to the same rule instead of spelling it out again for itself.
 */
export function unpricedThroughout(spend: Pick<Spend, "usd" | "unpriced">): boolean {
  return spend.usd === 0 && spend.unpriced > 0;
}

/**
 * Whether anything at all was captured for a session.
 *
 * The nought-versus-unknown test at the grain of one session, as
 * `unpricedThroughout` is at the grain of a window. A session with no turns and
 * no calls behind it moved no tokens, so there is no rate it is missing: it
 * cost nothing, and that is a measurement rather than a gap. A session that ran
 * and cannot be priced is the other thing entirely, and the two may never be
 * printed the same way.
 */
export function wasMeasured(cost: Pick<SessionCost, "turns" | "apiCalls">): boolean {
  return cost.turns > 0 || cost.apiCalls > 0;
}

/**
 * One session's money, or nothing where it ran on a model no rate covers.
 *
 * Every surface that prints a per-session figure goes through here, for the
 * same reason every surface that prints a total goes through
 * `unpricedThroughout`. The terminal table and the Markdown one are two views
 * of one record: a row reading an em dash in the terminal and `$0.00` in the
 * document somebody pasted into Notion is this tool failing at the one thing it
 * claims. That is what happened while this carve-out lived in the Markdown
 * renderer alone — and the terminal row disagreed with the footer directly
 * under it, which counted no unpriced sessions and said `$0.00 spent`.
 *
 * `undefined` rather than a word, because the word is the surface's own: a
 * column read at a glance has an em dash to spare, a table read cold spells it
 * out. What may not differ between them is which sessions get it.
 */
export function sessionFigure(cost: SessionCost, rates: RateTable): string | undefined {
  const price = priceSession(cost, rates);
  if (price.priced) {
    return formatUsd(price.usd);
  }
  return wasMeasured(cost) ? undefined : formatUsd(0);
}

/**
 * Money, as a line of a report reads it.
 *
 * Always two decimal places, so a column of them lines up on the point. A
 * non-zero amount too small to show at that precision reads `<$0.01` rather
 * than `$0.00` — the session cost something, and a rounded nought says it did
 * not.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) {
    return "<$0.01";
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// --- the file a reader has to write --------------------------------------

/** Where a reader whose model has no price is sent to give it one. */
export const USER_RATES_FILE = "~/.session/rates.json";

/**
 * The four fields an entry needs, in the order the file writes them.
 *
 * One list, read by the thing that checks a file and by the thing that offers
 * one to write. Two copies could come to disagree, and the way that shows up
 * is a stub this tool printed being rejected by this tool.
 */
const RATE_FIELDS = ["input", "cacheRead", "cacheCreation", "output"] as const;

/** What the stub says about the noughts in it, so nobody pastes them as prices. */
const STUB_NOTE =
  "Replace every 0 below with that model's published price in dollars per " +
  "million tokens. A rate left at 0 prices the model at nothing, which is not " +
  "the same as leaving it unpriced.";

/**
 * A rates file for the models nothing could price.
 *
 * A whole file, not a fragment. The reader this is for has just been told a
 * figure is missing and is looking at a format they have never seen; handing
 * them `"input": 0` and leaving them to work out what it hangs off is how a
 * week goes unpriced for a month. What comes back from here can be saved as
 * `~/.session/rates.json` as it stands, and `parseRates` accepts it — the
 * fields come off the same list `readRate` checks against.
 *
 * The noughts are placeholders and are labelled as placeholders. A stub that
 * guessed at the price would be the one thing this file refuses to do
 * anywhere else, and a stub with the numbers left out would not parse.
 */
export function rateStub(models: readonly string[]): string {
  const fields = RATE_FIELDS.map((field) => `"${field}": 0`).join(", ");
  const entries = models.map((model) => `    ${JSON.stringify(model)}: { ${fields} }`);

  return [
    "{",
    `  "note": ${JSON.stringify(STUB_NOTE)},`,
    '  "models": {',
    entries.join(",\n"),
    "  }",
    "}",
  ].join("\n");
}

// --- loading the table ---------------------------------------------------

/** The name of the file, in both places one lives. */
export const RATES_FILE = "rates.json";

/** The table that ships with the package, beside `dist/` and beside `src/`. */
export const bundledRatesFile = (): URL => new URL(`../${RATES_FILE}`, import.meta.url);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRate(value: unknown, model: string, source: string): ModelRate {
  const fields = isObject(value) ? value : {};

  for (const kind of RATE_FIELDS) {
    const rate = fields[kind];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
      throw new Error(
        `${source}: ${model} needs ${kind} as a number of dollars per million tokens, 0 or more.`,
      );
    }
  }

  return {
    input: fields["input"] as number,
    cacheRead: fields["cacheRead"] as number,
    cacheCreation: fields["cacheCreation"] as number,
    output: fields["output"] as number,
  };
}

/** Reads a rates file's text. Pure, so a table can be tested without a disk. */
export function parseRates(text: string, source: string): RateTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON.`, { cause: error });
  }

  const models = isObject(parsed) ? parsed["models"] : undefined;
  if (!isObject(models)) {
    throw new Error(
      `${source} needs a "models" object, one entry per model: ` +
        `{"models": {"claude-opus-5": {"input": 5, "cacheRead": 0.5, ` +
        `"cacheCreation": 6.25, "output": 25}}}`,
    );
  }

  const table = new Map<string, ModelRate>();
  for (const [model, value] of Object.entries(models)) {
    table.set(model, readRate(value, model, source));
  }
  return table;
}

/**
 * The rates in force: the bundled table, with anything in `~/.session/rates.json`
 * merged over it entry by entry.
 *
 * Entry by entry rather than wholesale so adding one model does not mean
 * copying the file and inheriting its staleness. This is the one thing under
 * `~/.session` that is not the tool's own bookkeeping, and it is not a setting:
 * what a model costs is a fact about a bill, and the bundled numbers go out of
 * date the moment a vendor changes them.
 */
export async function loadRates(home?: string): Promise<RateTable> {
  const bundled = bundledRatesFile();
  const table = parseRates(await readFile(bundled, "utf8"), path.basename(bundled.pathname));

  if (home === undefined) {
    return table;
  }

  const override = path.join(home, RATES_FILE);
  let text: string;
  try {
    text = await readFile(override, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return table; // nobody keeps their own rates here, which is the normal case
    }
    throw error;
  }

  return new Map([...table, ...parseRates(text, override)]);
}
