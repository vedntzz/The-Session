import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatStopConfirmation } from "../src/render/terminal/stop.js";
import { cellWidth } from "../src/render/tui/text.js";

const stopped = (overrides: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the UI", scope: ["src/"], baseline: [], reality: [], drift: [],
  cost: zeroCost(), outcome: "empty", startCommit: "1234567", startedAt: "2026-01-15T14:02:00Z", endedAt: "2026-01-15T14:39:00Z", ...overrides,
});
const rates = new Map([["priced", { input: 2, cacheRead: 3, cacheCreation: 5, output: 7 }],
  ["second", { input: 11, cacheRead: 13, cacheCreation: 17, output: 7 }]]);
const counted = (overrides: Partial<SessionCost> = {}): SessionCost => ({ ...zeroCost(), model: "priced", turns: 1, ...overrides });
it.each(["empty", "open", "merged", "abandoned"] as const)("shows the resolved %s outcome before the declaration", (outcome) => {
  const lines = formatStopConfirmation(stopped({ outcome }));
  expect(lines).toContain(`  outcome     ${outcome}`);
  expect(lines.indexOf(`  outcome     ${outcome}`)).toBeLessThan(lines.indexOf("  intent      Build the UI"));
});
it.each([
  [counted({ turns: 0, inputTokens: 100_000 }), "unknown"], [counted({ model: "" }), "unknown"],
  [counted({ model: "missing", inputTokens: 100_000 }), "unknown"], [counted(), "$0.00"],
  [counted({ inputTokens: 1 }), "<$0.01"], [counted({ inputTokens: 100_000 }), "$0.20"],
] as const)("quotes only priced measured money: %j", (cost, value) => {
  const lines = formatStopConfirmation(stopped({ cost }), plainPalette, ["  cost     obsolete tokens and price"], undefined, { rates });
  expect(lines).toContain(`  cost        ${value}`); expect(lines.filter((line) => line.startsWith("  cost"))).toHaveLength(1);
  expect(lines.join("\n")).not.toContain("obsolete"); expect(lines.at(-2)).toBe(""); expect(lines.at(-1)).toBe("  next        session week last --full");
});
it.each([{ untokenedTurns: 1 }, { turnTokens: [null], turnModels: ["priced"] },
  { turns: 2, untokenedTurns: 1, turnTokens: [{ inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 }], turnModels: ["priced"] },
] as Partial<SessionCost>[])("keeps incomplete tokens and money unknown: %j", (partial) => {
  const cost = counted({ ...partial, inputTokens: 100_000 });
  const lines = formatStopConfirmation(stopped({ cost }), plainPalette, [], undefined, { rates });
  expect(lines).toContain(`  turns       ${cost.turns}`); expect(lines).toContain("  tokens      unknown"); expect(lines).toContain("  cost        unknown");
});
it("does not quote measured money when no rates were supplied", () => {
  expect(formatStopConfirmation(stopped({ cost: counted({ inputTokens: 100_000 }) }))).toContain("  cost        unknown");
});
it("combines each model's measured money without apportioning counters", () => {
  const a = { inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
  const b = { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 200_000 };
  const cost = counted({ ...a, outputTokens: b.outputTokens, turns: 2, model: "dominant", modelTokens: { priced: a, second: b } });
  const lines = formatStopConfirmation(stopped({ cost }), plainPalette, [], undefined, { rates });
  expect(lines).toContain("  turns       2"); expect(lines).toContain("  tokens      100,000 in · 0 cache read · 0 cache write · 200,000 out");
  expect(lines).toContain("  cost        $1.60"); expect(lines.filter((line) => line.includes("$"))).toHaveLength(1);
});
it.each([60, 80, undefined])("keeps four raw counters, dim money and color geometry at width %s", (width) => {
  const cost = counted({ inputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 3_000_000, outputTokens: 4_000_000 });
  const record = stopped({ cost }); const before = JSON.stringify(record); const dim: string[] = [];
  const plain = formatStopConfirmation(record, { ...plainPalette, meta: (text) => { dim.push(text); return text; } }, ["  note     safe\u001b[2J metadata"], width, { rates });
  const tokens = plain.findIndex((line) => line.startsWith("  tokens      ")); const money = plain.findIndex((line) => line.startsWith("  cost        "));
  expect(plain.slice(tokens, money).map((line) => line.slice(14)).join(" ")).toBe("1,000,000 in · 2,000,000 cache read · 3,000,000 cache write · 4,000,000 out");
  expect(plain).toContain("  cost        $51.00"); expect(dim).toContain("$51.00"); expect(plain).toContain("  note     safe metadata");
  expect(plain.indexOf("  turns       1")).toBeGreaterThan(plain.findIndex(line => /^  (?:id\s|│ id\s)/u.test(line)));
  expect(formatStopConfirmation(record, ansiPalette, ["  note     safe metadata"], width, { rates }).map(stripVTControlCharacters)).toEqual(plain);
  expect(formatStopConfirmation(record, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), ["  note     safe metadata"], width, { rates })).toEqual(plain);
  if (width !== undefined) expect(plain.every((line) => cellWidth(line) <= width)).toBe(true);
  expect(JSON.stringify(record)).toBe(before);
});
it.each([60, 80])("shows safe price provenance only beneath measured money at width %i", (width) => {
  const checked = "2026-01-15\u001b[2J"; const record = stopped({ cost: counted({ inputTokens: 100_000 }) }); const seen: string[] = [];
  const lines = formatStopConfirmation(record, { ...plainPalette, meta: (text) => { seen.push(text); return text; } }, [], width, { rates, checked });
  const money = lines.indexOf("  cost        $0.20"); const note = lines.slice(money + 1, -2);
  expect(note.map((line) => line.trimStart()).join(" ")).toBe("prices checked 2026-01-15 — override in ~/.session/rates.json");
  expect(lines.every((line) => cellWidth(line) <= width)).toBe(true); expect(seen.join("\n")).not.toContain("\u001b");
  expect(lines.filter((line) => line.includes("$"))).toHaveLength(1);
  expect(formatStopConfirmation(record, ansiPalette, [], width, { rates, checked }).map(stripVTControlCharacters)).toEqual(lines);
  const unknown = formatStopConfirmation(stopped(), plainPalette, [], width, { rates, checked });
  expect(unknown.join("\n")).not.toContain("prices checked");
});
it("can show unavailable outcome evidence without changing the resolved record", () => {
  const record = stopped({ outcome: "merged" }); const before = JSON.stringify(record);
  const lines = formatStopConfirmation(record, plainPalette, [], undefined, { outcome: "unknown" });
  expect(lines).toContain("  outcome     unknown"); expect(JSON.stringify(record)).toBe(before);
});
