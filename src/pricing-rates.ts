// The rates file: what a reader writes to price a model, and how the table in force is read. Pure above `loadChecked`.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelRate, RateTable } from "./pricing.js";

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

/** The field the bundled file states the date its prices were checked on. */
const CHECKED = "checked";

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
 * The date the bundled prices were last checked against the vendors' pages.
 *
 * A price is a fact with a date on it, and every figure this tool prints is
 * quoted at one. The file has always carried the date and a note saying the
 * numbers go stale the moment a vendor moves them; nothing surfaced either, so
 * a reader was told what a week cost and never told how old the prices were.
 *
 * `undefined` where the file states no date, which is what a hand-edited or
 * older file may do. A view with nothing to say about the age of its prices
 * says nothing, rather than guessing at a date or calling them current.
 *
 * The JSON is not validated here — `loadRates` reads the same file and says
 * what is wrong with it in the words of the fault.
 */
export function parseChecked(text: string): string | undefined {
  const parsed: unknown = JSON.parse(text);
  const checked = isObject(parsed) ? parsed[CHECKED] : undefined;
  return typeof checked === "string" && checked !== "" ? checked : undefined;
}

/**
 * The bundled table's date, for the views that quote its prices.
 *
 * The bundled file only. `~/.session/rates.json` is merged over it entry by
 * entry, so a date there would cover some models and not others — and it is
 * the file the note tells the reader to write, not one this tool dates.
 */
export async function loadChecked(): Promise<string | undefined> {
  return parseChecked(await readFile(bundledRatesFile(), "utf8"));
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
