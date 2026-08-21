import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bundledRatesFile,
  formatUsd,
  loadRates,
  parseRates,
  priceSession,
  priceTokens,
  rateFor,
  spendOf,
  unpricedThroughout,
  type ModelRate,
  type RateTable,
} from "../src/pricing.js";
import { zeroCost, zeroTokens, type Session, type SessionCost } from "../src/store.js";

/**
 * The arithmetic and the table lookup are pure and tested as such. Only the
 * last block touches a disk, and only to prove that the bundled file is real
 * and that a file in `~/.session` lands on top of it.
 */

const OPUS: ModelRate = { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 };
const HAIKU: ModelRate = { input: 1, cacheRead: 0.1, cacheCreation: 1.25, output: 5 };

const rates: RateTable = new Map([
  ["claude-opus-4-1", OPUS],
  ["claude-haiku-4-5", HAIKU],
]);

function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), ...overrides };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: "2026-08-15T09:00:00.000Z",
    endedAt: "2026-08-15T11:30:00.000Z",
    startCommit: "cdd3b4f",
    ...overrides,
  };
}

describe("priceTokens", () => {
  it("prices each counter at its own rate", () => {
    // 1M of each: 15 + 1.5 + 18.75 + 75.
    const price = priceTokens(
      {
        inputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      OPUS,
    );

    expect(price).toBeCloseTo(110.25, 10);
  });

  it("charges cache reads a fraction of fresh input", () => {
    const cached = priceTokens({ ...zeroTokens(), cacheReadTokens: 1_000_000 }, OPUS);
    const fresh = priceTokens({ ...zeroTokens(), inputTokens: 1_000_000 }, OPUS);

    // The distinction the four counters exist for: collapsing them into one
    // total would price this session ten times over.
    expect(cached * 10).toBeCloseTo(fresh, 10);
  });

  it("is zero for a session that moved nothing", () => {
    expect(priceTokens(zeroTokens(), OPUS)).toBe(0);
  });
});

describe("rateFor", () => {
  it("matches a model named exactly", () => {
    expect(rateFor("claude-opus-4-1", rates)?.key).toBe("claude-opus-4-1");
  });

  it("matches the dated snapshot a transcript actually reports", () => {
    expect(rateFor("claude-opus-4-1-20250805", rates)?.rate).toBe(OPUS);
  });

  it("takes the longest key that fits, not the first", () => {
    const table: RateTable = new Map([
      ["claude-opus-4", HAIKU],
      ["claude-opus-4-1", OPUS],
    ]);

    expect(rateFor("claude-opus-4-1-20250805", table)?.key).toBe("claude-opus-4-1");
  });

  it("only matches at a dash", () => {
    // Otherwise `claude-opus-4` prices `claude-opus-45`, a model nobody quoted.
    expect(rateFor("claude-opus-4123", new Map([["claude-opus-4", OPUS]]))).toBeUndefined();
  });

  it("has nothing for a model the table has never heard of", () => {
    expect(rateFor("gpt-9", rates)).toBeUndefined();
    expect(rateFor("", rates)).toBeUndefined();
  });
});

describe("priceSession", () => {
  it("prices a session and says which entry did it", () => {
    const price = priceSession(
      cost({ model: "claude-opus-4-1-20250805", outputTokens: 1_000_000 }),
      rates,
    );

    expect(price).toMatchObject({ priced: true, matched: "claude-opus-4-1", usd: 75 });
  });

  it("prices the empty turns separately, from what was counted", () => {
    const price = priceSession(
      cost({
        model: "claude-opus-4-1",
        outputTokens: 1_000_000,
        emptyTurnTokens: { ...zeroTokens(), outputTokens: 200_000 },
      }),
      rates,
    );

    expect(price.priced && price.emptyUsd).toBe(15);
  });

  it("leaves the empty-turn figure out when nothing counted it", () => {
    // Old records carry no split. A share of the total worked out from the turn
    // count would read as a measurement, so there is no figure at all.
    const old = cost({ model: "claude-opus-4-1", outputTokens: 1_000_000 });
    delete old.emptyTurnTokens;

    const price = priceSession(old, rates);
    expect(price.priced).toBe(true);
    expect(price.priced && price.emptyUsd).toBeUndefined();
  });

  it("refuses to price a model it has no rate for", () => {
    const price = priceSession(cost({ model: "claude-opus-5", outputTokens: 1_000_000 }), rates);

    expect(price).toEqual({ priced: false, model: "claude-opus-5" });
  });
});

describe("spendOf", () => {
  const spent = (model: string, tokens: number, overrides: Partial<Session> = {}): Session =>
    session({ cost: cost({ model, outputTokens: tokens, turns: 1, apiCalls: 1 }), ...overrides });

  it("adds up what a window cost", () => {
    const spend = spendOf(
      [spent("claude-opus-4-1", 1_000_000), spent("claude-haiku-4-5", 1_000_000)],
      rates,
    );

    expect(spend.usd).toBe(80);
  });

  it("counts everything that is not merged against the unmerged figure", () => {
    const spend = spendOf(
      [
        spent("claude-opus-4-1", 1_000_000, { outcome: "merged" }),
        spent("claude-opus-4-1", 1_000_000, { outcome: "abandoned" }),
        spent("claude-opus-4-1", 1_000_000, { outcome: "open" }),
      ],
      rates,
    );

    expect(spend.usd).toBe(225);
    // Open work has not paid for itself yet either, which is the point of
    // seeing the number while the week is still running.
    expect(spend.unmerged).toBe(150);
  });

  it("keeps a session that changed nothing out of the unmerged figure", () => {
    const spend = spendOf(
      [
        spent("claude-opus-4-1", 1_000_000, { outcome: "abandoned" }),
        spent("claude-opus-4-1", 1_000_000, { outcome: "empty", reality: [] }),
      ],
      rates,
    );

    // Both were spent; only one of them is money on changes that never
    // merged. A session that changed no files has no unlanded work, and
    // counting it here would fill a figure about work that was thrown away
    // with sessions where none was done.
    expect(spend.usd).toBe(150);
    expect(spend.unmerged).toBe(75);
  });

  it("counts the sessions it could not price, and names their models", () => {
    const spend = spendOf(
      [
        spent("claude-opus-4-1", 1_000_000),
        spent("claude-opus-5", 1_000_000),
        spent("claude-opus-5", 500_000),
      ],
      rates,
    );

    expect(spend.usd).toBe(75);
    expect(spend.unpriced).toBe(2);
    expect(spend.unpricedModels).toEqual(["claude-opus-5"]);
  });

  it("does not call a session with no captured cost unpriced", () => {
    // Nothing was spent, so no rate is missing. Reporting a gap here would
    // report one on every session recorded before a transcript was found.
    const spend = spendOf([session()], rates);

    expect(spend).toMatchObject({ usd: 0, unpriced: 0, unpricedModels: [] });
  });

  it("is all zeroes for an empty window", () => {
    expect(spendOf([], rates)).toEqual({
      usd: 0,
      unmerged: 0,
      unpriced: 0,
      unpricedModels: [],
    });
  });
});

describe("unpricedThroughout", () => {
  const spent = (model: string, tokens: number): Session =>
    session({ cost: cost({ model, outputTokens: tokens, turns: 1, apiCalls: 1 }) });

  it("is true where the total is nought only because no rate was found", () => {
    const spend = spendOf([spent("claude-opus-5", 1_000_000)], rates);

    expect(spend.usd).toBe(0);
    expect(unpricedThroughout(spend)).toBe(true);
  });

  it("is false for a window that genuinely cost nothing", () => {
    // Nothing captured, so no rate is missing and the nought is a fact. This
    // is the half of the test that stops a view dashing out a real $0.00.
    const spend = spendOf([session()], rates);

    expect(spend.usd).toBe(0);
    expect(unpricedThroughout(spend)).toBe(false);
  });

  it("is false as soon as one session could be priced", () => {
    // A mixed window has a figure, even though it is a figure over part of
    // the window — which is what the note beside it is for.
    const spend = spendOf(
      [spent("claude-opus-4-1", 1_000_000), spent("claude-opus-5", 1_000_000)],
      rates,
    );

    expect(unpricedThroughout(spend)).toBe(false);
  });

  it("is false for an empty window", () => {
    expect(unpricedThroughout(spendOf([], rates))).toBe(false);
  });
});

describe("formatUsd", () => {
  it("always shows cents, so a column lines up on the point", () => {
    expect(formatUsd(4.125)).toBe("$4.13");
    expect(formatUsd(312)).toBe("$312.00");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("separates thousands", () => {
    expect(formatUsd(12_345.6)).toBe("$12,345.60");
  });

  it("says an amount is small rather than rounding it to nothing", () => {
    // A session that cost a fraction of a cent still cost something, and
    // `$0.00` would say it did not.
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.005)).toBe("$0.01");
  });
});

describe("parseRates", () => {
  const text = JSON.stringify({
    models: { "m-1": { input: 1, cacheRead: 2, cacheCreation: 3, output: 4 } },
  });

  it("reads a table", () => {
    expect(parseRates(text, "rates.json").get("m-1")).toEqual({
      input: 1,
      cacheRead: 2,
      cacheCreation: 3,
      output: 4,
    });
  });

  it("names the file when the JSON is broken", () => {
    expect(() => parseRates("{oops", "/tmp/rates.json")).toThrow(/\/tmp\/rates\.json is not valid/);
  });

  it("shows the shape it wanted when there is no models object", () => {
    expect(() => parseRates("{}", "rates.json")).toThrow(/needs a "models" object.*cacheRead/s);
  });

  it("names the model and the missing rate", () => {
    const partial = JSON.stringify({ models: { "m-1": { input: 1, output: 4 } } });

    expect(() => parseRates(partial, "rates.json")).toThrow(/m-1 needs cacheRead/);
  });

  it("refuses a rate that is not a number, or is below zero", () => {
    const bad = (value: unknown): string =>
      JSON.stringify({ models: { "m-1": { input: value, cacheRead: 0, cacheCreation: 0, output: 0 } } });

    expect(() => parseRates(bad("15"), "rates.json")).toThrow(/m-1 needs input/);
    expect(() => parseRates(bad(-1), "rates.json")).toThrow(/m-1 needs input/);
  });
});

describe("the bundled table", () => {
  it("ships beside the package and parses", async () => {
    const table = await loadRates();

    expect(table.size).toBeGreaterThan(0);
    expect(bundledRatesFile().pathname).toMatch(/rates\.json$/);
  });

  it("prices the models the tool is most likely to meet", async () => {
    const table = await loadRates();

    expect(rateFor("claude-sonnet-4-5-20250929", table)).toBeDefined();
    expect(rateFor("claude-opus-4-1-20250805", table)).toBeDefined();
  });

  it("quotes cache reads below fresh input for every model in it", async () => {
    // A table where the discount went the wrong way would price a long
    // session at several times what it cost, and nothing else would catch it.
    for (const [model, rate] of await loadRates()) {
      expect(rate.cacheRead, model).toBeLessThan(rate.input);
      expect(rate.output, model).toBeGreaterThanOrEqual(rate.input);
    }
  });
});

describe("loadRates", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "session-rates-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns the bundled table when nobody keeps their own", async () => {
    const mine = await loadRates(home);
    const bundled = await loadRates();

    expect(mine.size).toBe(bundled.size);
  });

  it("merges an override entry by entry, so one model can be added alone", async () => {
    await writeFile(
      path.join(home, "rates.json"),
      JSON.stringify({
        models: { "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 } },
      }),
      "utf8",
    );

    const table = await loadRates(home);

    expect(table.get("claude-opus-5")?.output).toBe(25);
    // Adding one model must not cost you the rest of the file.
    expect(rateFor("claude-sonnet-4-5", table)).toBeDefined();
  });

  it("lets an override correct a bundled price", async () => {
    await writeFile(
      path.join(home, "rates.json"),
      JSON.stringify({
        models: { "claude-opus-4-1": { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 } },
      }),
      "utf8",
    );

    expect((await loadRates(home)).get("claude-opus-4-1")?.output).toBe(1);
  });

  it("names the override when it cannot be read", async () => {
    const file = path.join(home, "rates.json");
    await writeFile(file, "{}", "utf8");

    await expect(loadRates(home)).rejects.toThrow(new RegExp(`${file}.*models`, "s"));
  });
});
