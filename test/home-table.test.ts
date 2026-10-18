import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatHome, type Home } from "../src/render/terminal.js";
import { cellWidth } from "../src/render/tui/text.js";
import { zeroCost, type Session } from "../src/store.js";
import { tableValues } from "./fixtures/table.js";

const session = (fields: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the terminal UI", scope: ["src/"],
  baseline: [], reality: [], drift: [], cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: "2026-10-17T15:24:00.000Z", endedAt: null, ...fields,
});
const states: Home[] = [{}, { running: session() }, { last: session({ endedAt: "2026-10-17T16:00:00.000Z" }) }];

it.each([40, 60, 80, 120])("frames every home state at %i columns with two next commands", width => {
  for (const home of states) {
    const lines = formatHome(home, plainPalette, { width });
    const table = lines.filter(line => /[│╭╰├]/u.test(line));
    expect(table.length).toBeGreaterThan(3);
    expect(new Set(table.map(cellWidth))).toEqual(new Set([Math.min(width, 80)]));
    expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
    expect(lines.filter(line => /^\s+(?:next\s+)?session /u.test(line))).toHaveLength(2);
  }
});

it("keeps every word and literal path while showing the running record", () => {
  const intent = "Keep all declared words visible. ".repeat(5).trim();
  const path = "資料/" + "e\u0301界".repeat(40) + ".ts";
  const running = session({ intent, scope: [path, "notes/a  file.ts"] });
  const before = structuredClone(running); const lines = formatHome({ running }, plainPalette, { width: 40 });
  expect(tableValues(lines, "intent").join(" ")).toBe(intent);
  const paths = tableValues(lines, "scope");
  expect(paths.slice(0, -1).join("")).toBe(path); expect(paths.at(-1)).toBe("notes/a  file.ts");
  expect(tableValues(lines, "id")).toEqual(["abcdef01"]); expect(running).toEqual(before);
});

it("preserves the captured prompt boundary and does not display stale scope", () => {
  const running = session({ intent: "First line\nSecond line", intentSource: "captured", scope: ["stale/"] });
  const lines = formatHome({ running }, plainPalette, { width: 80 });
  expect(tableValues(lines, "prompt")).toEqual(["First line …"]);
  expect(tableValues(lines, "scope")).toEqual(["none declared"]);
  expect(lines.join("\n")).not.toContain("Second line"); expect(lines.join("\n")).not.toContain("stale/");
});

it.each([undefined, "paste-only"] as const)("keeps unknown intent and its factual reason: %s", intentMissing => {
  const running = session({ intent: null, intentSource: "captured", intentMissing });
  const lines = formatHome({ running }, plainPalette, { width: 80 });
  expect(tableValues(lines, "prompt")).toEqual(["unknown", intentMissing
    ? "the first prompt was pasted text, not captured" : "no intent recorded yet"]);
});

const rates = new Map([["priced", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }]]);
it.each([[0, 100_000, "unknown"], [1, 0, "$0.00"], [1, 100_000, "$1.50"]] as const)(
  "preserves the recorded cost semantics for %i turns and %i input tokens", (turns, inputTokens, expected) => {
    const last = session({ endedAt: "2026-10-17T16:00:00Z", cost: { ...zeroCost(), model: "priced", turns, inputTokens } });
    const lines = formatHome({ last }, plainPalette, { rates, width: 80 });
    expect(tableValues(lines, "cost")).toEqual([expected]);
  },
);

it("keeps partially captured cost unknown", () => {
  const last = session({ endedAt: "2026-10-17T16:00:00Z", cost: { ...zeroCost(), turns: 2, model: "priced",
    inputTokens: 100_000, untokenedTurns: 1 } });
  expect(tableValues(formatHome({ last }, plainPalette, { rates, width: 80 }), "cost")).toEqual(["unknown"]);
});

it("shows an empty declared scope explicitly", () => {
  const lines = formatHome({ running: session({ scope: [] }) }, plainPalette, { width: 40 });
  expect(tableValues(lines, "scope")).toEqual(["none declared"]);
});

it("keeps colour optional and strips record controls before applying it", () => {
  const home = { running: session({ intent: "Build\u001b[2J safely", scope: ["src/\u001b[31mfile.ts"] }) };
  const plain = formatHome(home, plainPalette, { width: 40 });
  expect(formatHome(home, ansiPalette, { width: 40 }).map(stripVTControlCharacters)).toEqual(plain);
  expect(tableValues(plain, "intent")).toEqual(["Build safely"]);
  expect(tableValues(plain, "scope")).toEqual(["src/file.ts"]);
  expect(plain.join("\n")).not.toContain("\u001b");
});

it("leaves existing pipe output undecorated", () => {
  const lines = formatHome({ running: session() });
  expect(lines).toContain("  intent      Build the terminal UI");
  expect(lines.some(line => /[│╭╰├]/u.test(line))).toBe(false);
});
