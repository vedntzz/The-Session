// The contract that makes a third intent source safe to add: every site that
// branches on one answers for all of them, and the tables that answer stay in
// step with each other.
import { describe, expect, it } from "vitest";
import {
  hasDeclaredScope,
  inOwnWords,
  INTENT_SOURCES,
  intentSourceOf,
  parseIntentSource,
  sourceHasScope,
  zeroCost,
  type IntentSource,
  type Session,
} from "../src/store.js";
import { driftOf } from "../src/commands/stop.js";
import {
  INTENT_LEGEND,
  INTENT_MARKER,
  INTENT_NOTE,
  intentLegends,
  markedIntent,
} from "../src/render/terminal/intent.js";
import { GROUPS, NONE } from "../src/render/estimate.js";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: ["src/api/"],
    baseline: [],
    reality: ["src/api/orders.ts", "db/schema.py"],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: "2026-01-15T14:02:00.000Z",
    endedAt: "2026-01-15T14:39:00.000Z",
    startCommit: "abc1234",
    ...overrides,
  };
}

describe("the source list", () => {
  it("holds the two the record uses, strongest promise first", () => {
    expect([...INTENT_SOURCES]).toEqual(["declared", "captured"]);
  });

  it("round-trips every one of them through the parser", () => {
    for (const source of INTENT_SOURCES) {
      expect(parseIntentSource(source)).toBe(source);
    }
  });

  it("names every source when it refuses one", () => {
    for (const source of INTENT_SOURCES) {
      expect(() => parseIntentSource("hook")).toThrow(source);
    }
  });
});

/**
 * The guard the whole design rests on. A `Record<IntentSource, …>` is a
 * compile error when a key is missing, but a table reached by index will
 * happily hand back `undefined` if one is ever made optional — so each is
 * checked here as well, at the grain a reader can see.
 */
describe("every table answers for every source", () => {
  const tables: Record<string, Record<IntentSource, unknown>> = {
    INTENT_MARKER,
    INTENT_NOTE,
    INTENT_LEGEND,
    GROUPS,
    NONE,
  };

  for (const [name, table] of Object.entries(tables)) {
    it(`${name} has a key for each of them and no others`, () => {
      expect(Object.keys(table).sort()).toEqual([...INTENT_SOURCES].sort());
    });
  }

  it("gives every source a scope answer and an authorship answer", () => {
    for (const source of INTENT_SOURCES) {
      expect(typeof sourceHasScope(source)).toBe("boolean");
      expect(typeof inOwnWords(session({ intentSource: source }))).toBe("boolean");
    }
  });

  /**
   * `pr` decides whether to shorten an intent on `inOwnWords` and takes the
   * label off `INTENT_NOTE`. Two tables, one question, so they are pinned
   * together rather than left to drift apart.
   */
  it("gives a note to exactly the sources whose words are not the developer's", () => {
    for (const source of INTENT_SOURCES) {
      const own = inOwnWords(session({ intentSource: source }));
      expect(INTENT_NOTE[source] === undefined).toBe(own);
    }
  });

  /** A marker with no legend, or a legend with no marker, explains nothing. */
  it("gives a marker to exactly the sources that carry a legend", () => {
    for (const source of INTENT_SOURCES) {
      expect(INTENT_MARKER[source] === "").toBe(INTENT_LEGEND[source] === undefined);
    }
  });
});

describe("a source that is not the developer's own words", () => {
  it("has no scope, so drift is not measured against one", () => {
    const hooked = session({ intentSource: "captured", scope: [] });

    expect(hasDeclaredScope(hooked)).toBe(false);
    expect(driftOf(hooked, ["src/api/orders.ts", "db/schema.py"])).toEqual([]);
  });

  it("is drift-measured when the developer declared the scope", () => {
    const declared = session({ intentSource: "declared" });

    expect(hasDeclaredScope(declared)).toBe(true);
    expect(driftOf(declared, ["src/api/orders.ts", "db/schema.py"])).toEqual(["db/schema.py"]);
  });

  it("carries a marker only where the words are not the developer's", () => {
    expect(inOwnWords(session({ intentSource: "declared" }))).toBe(true);
    expect(inOwnWords(session({ intentSource: "captured" }))).toBe(false);
    expect(markedIntent(session({ intentSource: "captured" }))).toBe(
      "~ add rate limiting to /orders",
    );
    expect(markedIntent(session({ intentSource: "declared" }))).toBe(
      "add rate limiting to /orders",
    );
  });

  it("reads as declared on a record written before the field existed", () => {
    expect(intentSourceOf({})).toBe("declared");
  });
});

describe("the legends", () => {
  it("names only the markers the rows in front of it carry", () => {
    const legends = intentLegends([
      session({ intentSource: "captured" }),
      session({ intentSource: "captured" }),
      session({ intentSource: "declared" }),
    ]);

    expect(legends).toHaveLength(1);
    expect(legends[0]).toMatchObject({ source: "captured", marker: "~", count: 2 });
  });

  it("comes back in source order", () => {
    const legends = intentLegends([session({ intentSource: "captured" })]);

    expect(legends.map((legend) => legend.source)).toEqual(["captured"]);
  });

  it("says nothing at all for a table of declarations", () => {
    expect(intentLegends([session(), session()])).toEqual([]);
  });
});
