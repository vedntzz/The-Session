import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { stopEvidenceRows } from "../src/render/terminal/stop-evidence.js";
import { cellWidth } from "../src/render/tui/text.js";
import { tableValues } from "./fixtures/table.js";

const rates = new Map([["priced", { input: 2, cacheRead: 3, cacheCreation: 5, output: 7 }],
  ["second", { input: 11, cacheRead: 13, cacheCreation: 17, output: 7 }]]);
const counted = (fields: Partial<SessionCost> = {}): SessionCost => ({ ...zeroCost(), model: "priced", turns: 1, ...fields });
const record = (cost: SessionCost): Session => ({
  id: "abcdef01", repo: "local:test", intent: "Build the UI", scope: ["src/"], baseline: [], reality: [], drift: [],
  cost, outcome: "open", startCommit: "1234567", startedAt: "2026-10-17T15:24:00Z", endedAt: "2026-10-17T15:28:00Z",
});

it.each([40, 60, 80])("tables every counter and one dim total at %i columns", width => {
  const session = record(counted({ inputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 3_000_000, outputTokens: 4_000_000 }));
  const before = structuredClone(session); const dim: string[] = [];
  const lines = stopEvidenceRows(session, { ...plainPalette, meta: text => { dim.push(text); return text; } }, width, { rates });
  expect(tableValues(lines, "turns")).toEqual(["1"]);
  expect(tableValues(lines, "tokens").join(" ")).toBe("1,000,000 in · 2,000,000 cache read · 3,000,000 cache write · 4,000,000 out");
  expect(tableValues(lines, "cost")).toEqual(["$51.00"]); expect(dim.some(text => text.trim() === "$51.00")).toBe(true);
  expect(lines.filter(line => line.includes("$")).length).toBe(1);
  expect(new Set(lines.filter(Boolean).map(cellWidth))).toEqual(new Set([width]));
  expect(stopEvidenceRows(session, ansiPalette, width, { rates }).map(stripVTControlCharacters)).toEqual(lines);
  expect(session).toEqual(before);
});

it.each([
  [zeroCost(), "unknown", "unknown"], [counted({ turns: 0, apiCalls: 2 }), "unknown", "unknown"],
  [counted({ untokenedTurns: 1 }), "1", "unknown"], [counted({ turnTokens: [null] }), "1", "unknown"],
  [counted({ model: "missing" }), "1", "0 in · 0 cache read · 0 cache write · 0 out"],
] as const)("keeps unavailable money unknown: %j", (cost, turns, tokens) => {
  const lines = stopEvidenceRows(record(cost), plainPalette, 80, { rates, checked: "2026-10-17" });
  expect(tableValues(lines, "turns")).toEqual([turns]); expect(tableValues(lines, "tokens").join(" ")).toBe(tokens);
  expect(tableValues(lines, "cost")).toEqual(["unknown"]); expect(lines.join("\n")).not.toContain("prices checked");
});

it("distinguishes measured zero from absent rates", () => {
  const session = record(counted());
  expect(tableValues(stopEvidenceRows(session, plainPalette, 80, { rates }), "cost")).toEqual(["$0.00"]);
  expect(tableValues(stopEvidenceRows(session, plainPalette, 80), "cost")).toEqual(["unknown"]);
});

it("keeps shared mixed-model cost combined and refuses a missing model rate", () => {
  const priced = { inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
  const second = { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 200_000 };
  const session = record(counted({ ...priced, outputTokens: second.outputTokens, turns: 2, model: "dominant", modelTokens: { priced, second } }));
  const lines = stopEvidenceRows(session, plainPalette, 80, { rates });
  expect(tableValues(lines, "cost")).toEqual(["$1.60"]); expect(lines.filter(line => line.includes("$"))).toHaveLength(1);
  expect(tableValues(lines, "tokens").join(" ")).toBe("100,000 in · 0 cache read · 0 cache write · 200,000 out");
  expect(tableValues(stopEvidenceRows(session, plainPalette, 80, { rates: new Map([["priced", rates.get("priced")!]]) }), "cost")).toEqual(["unknown"]);
});
