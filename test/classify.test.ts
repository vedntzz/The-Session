import { describe, expect, it } from "vitest";
import {
  CLASS_RULES,
  SESSION_CLASSES,
  classOf,
  classOfPath,
  classifyPaths,
  parseClass,
} from "../src/classify.js";
import { zeroCost, type Session } from "../src/store.js";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: "2026-01-15T09:14:00.000Z",
    endedAt: "2026-01-15T09:51:00.000Z",
    startCommit: "abc1234",
    ...overrides,
  };
}

describe("the rule table", () => {
  // The examples are what makes the table readable, so they have to be true.
  // A rule added above another one that shadows its example fails here rather
  // than quietly relabelling a week of sessions.
  it.each(CLASS_RULES.map((rule) => [rule.example, rule.class] as const))(
    "classifies %s as %s",
    (example, expected) => {
      expect(classOfPath(example)).toBe(expected);
    },
  );

  it("uses only classes that exist", () => {
    for (const rule of CLASS_RULES) {
      expect(SESSION_CLASSES).toContain(rule.class);
    }
  });
});

describe("classOfPath", () => {
  it("falls back to other for a path no rule claims", () => {
    expect(classOfPath("src/store.ts")).toBe("other");
    expect(classOfPath("")).toBe("other");
  });

  it("ignores case, so Dockerfile and README need no special case", () => {
    expect(classOfPath("Dockerfile")).toBe("build");
    expect(classOfPath("Makefile")).toBe("build");
    expect(classOfPath("CHANGELOG.md")).toBe("docs");
  });

  it("ignores a leading ./, the way scope entries do", () => {
    expect(classOfPath("./src/api/orders.ts")).toBe("api");
  });

  it("matches directories at boundaries, not as substrings", () => {
    expect(classOfPath("srcapi/orders.ts")).toBe("other");
    expect(classOfPath("legacyui/panel.ts")).toBe("other");
  });

  it("reads a test as a test whatever it is a test of", () => {
    expect(classOfPath("test/fixtures/orders.sql")).toBe("test");
    expect(classOfPath("src/api/orders.test.ts")).toBe("test");
    expect(classOfPath("tests/test_orders.py")).toBe("test");
  });

  it("reads a workflow file as build rather than as settings", () => {
    expect(classOfPath(".github/workflows/release.yml")).toBe("build");
    expect(classOfPath("requirements.txt")).toBe("build");
    expect(classOfPath("tsconfig.test.json")).toBe("build");
  });

  it("reads writing about a thing as docs, not as the thing", () => {
    expect(classOfPath("docs/api/orders.md")).toBe("docs");
    expect(classOfPath("README.md")).toBe("docs");
  });

  it("keeps config for what is left, since json and yaml are everywhere", () => {
    expect(classOfPath("rates.json")).toBe("config");
    expect(classOfPath(".eslintrc.json")).toBe("config");
    expect(classOfPath("deploy/values.yaml")).toBe("build");
  });
});

describe("classifyPaths", () => {
  it("takes whichever class the most paths belong to", () => {
    expect(
      classifyPaths(["src/components/Button.tsx", "src/components/Card.tsx", "README.md"]),
    ).toBe("ui");
  });

  it("breaks a tie by the order of the table", () => {
    // One test file and one component: the table puts tests first, so a
    // session split evenly between them is a test session.
    expect(classifyPaths(["src/Button.test.tsx", "src/components/Card.tsx"])).toBe("test");
  });

  it("lets other win rather than borrowing a label from one stray file", () => {
    expect(classifyPaths(["src/store.ts", "src/pricing.ts", "src/app.css"])).toBe("other");
  });

  it("calls a session that changed nothing other", () => {
    expect(classifyPaths([])).toBe("other");
  });

  it("gives the same answer whatever order the paths arrive in", () => {
    const paths = ["db/migrate/006_orders.rb", "src/api/orders.ts", "db/schema.rb"];
    expect(classifyPaths(paths)).toBe(classifyPaths([...paths].reverse()));
  });
});

describe("classOf", () => {
  it("uses the class the record carries", () => {
    // Stored and derived disagree here so it is clear which one was read.
    expect(classOf(session({ class: "docs", reality: ["src/api/orders.ts"] }))).toBe("docs");
  });

  it("derives it from reality for a session stopped before the field existed", () => {
    expect(classOf(session({ reality: ["src/api/orders.ts"] }))).toBe("api");
  });
});

describe("parseClass", () => {
  it.each([...SESSION_CLASSES])("takes %s", (name) => {
    expect(parseClass(name)).toBe(name);
  });

  it("tolerates case and surrounding space", () => {
    expect(parseClass("  UI ")).toBe("ui");
  });

  it("names the alternatives when it is given something else", () => {
    expect(() => parseClass("frontend")).toThrow(/frontend is not a class/);
    expect(() => parseClass("frontend")).toThrow(/schema, api, ui, test, config, docs, build/);
  });
});
