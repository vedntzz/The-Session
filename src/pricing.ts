import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Session, SessionCost, TokenCounts } from "./store.js";

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
   * Of that, the sessions whose outcome is anything but merged. Open sessions
   * count: work that has not landed has not paid for itself yet, and a figure
   * that only counted the abandoned ones would flatter every week in progress.
   */
  unmerged: number;
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
  let usd = 0;
  let unmerged = 0;
  let unpriced = 0;

  for (const session of sessions) {
    const price = priceSession(session.cost, rates);
    if (!price.priced) {
      // A session that spent nothing at all needs no rate, and reporting it as
      // unpriced would be reporting a gap that costs nobody anything.
      if (session.cost.apiCalls > 0 || session.cost.turns > 0) {
        unpriced += 1;
        models.add(session.cost.model === "" ? "unknown" : session.cost.model);
      }
      continue;
    }
    usd += price.usd;
    if (session.outcome !== "merged") {
      unmerged += price.usd;
    }
  }

  return { usd, unmerged, unpriced, unpricedModels: [...models].sort() };
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
  const kinds = ["input", "cacheRead", "cacheCreation", "output"] as const;

  for (const kind of kinds) {
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
