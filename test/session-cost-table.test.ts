import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, zeroTokens, type Session, type SessionCost } from "../src/store.js";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatSession } from "../src/render/terminal/session.js";
import { cellWidth } from "../src/render/tui/text.js";
import { tableValues } from "./fixtures/table.js";

const rates = new Map([["priced", { input: 2, cacheRead: 3, cacheCreation: 5, output: 7 }],
  ["second", { input: 11, cacheRead: 13, cacheCreation: 17, output: 7 }]]);
const counted = (fields: Partial<SessionCost> = {}): SessionCost => ({ ...zeroCost(), model: "priced", turns: 1, ...fields });
const record = (cost = counted(), fields: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the terminal UI", scope: ["src/"], baseline: [],
  reality: ["src/panel.ts"], drift: [], cost, outcome: "open", startCommit: "1234567",
  startedAt: "2026-10-17T15:24:00Z", endedAt: "2026-10-17T15:28:00Z", ...fields,
});
const render = (session: Session, width = 80) => formatSession(session, plainPalette, { rates, width, tokens: true });

it.each([40, 60, 80])("tables four counters, provenance and one dim combined cost at %i columns", width => {
  const session = record(counted({ inputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 3_000_000, outputTokens: 4_000_000,
    turns: 2, apiCalls: 9, agents: ["agent-b", "agent-a"], capturedBy: "agent-session", turnModels: ["priced", "second"], importedTurnsSkipped: 2 }),
    { attribution: { client: "Acme", project: "terminal", sow: "SOW-42", billingCode: "ACME-42" } });
  const before = structuredClone(session); const seen: string[] = [];
  const lines = formatSession(session, { ...plainPalette, meta: text => { seen.push(text); return text; } }, { rates, width, tokens: true });
  expect(tableValues(lines, "turns")).toEqual(["2"]); expect(tableValues(lines, "calls")).toEqual(["unknown"]);
  expect(tableValues(lines, "tokens").join(" ")).toBe("1,000,000 in · 2,000,000 cache read · 3,000,000 cache write · 4,000,000 out");
  expect(tableValues(lines, "agents")).toEqual(["agent-a", "agent-b"]); expect(tableValues(lines, "models")).toEqual(["priced, second"]);
  expect(tableValues(lines, "imported").join(" ")).toBe("2 imported turns skipped, not counted");
  expect(tableValues(lines, "captured").join(" ")).toBe("its own agent sessions' transcripts");
  for (const [key, value] of Object.entries(session.attribution!)) expect(tableValues(lines, key)).toEqual([value]);
  expect(tableValues(lines, "cost")).toEqual(["$51.00"]); expect(seen.some(text => text.trim() === "$51.00")).toBe(true);
  expect(tableValues(lines, "empty turns")).toEqual(["unknown"]); expect(tableValues(lines, "no edits")).toEqual(["unknown"]);
  expect(lines.filter(line => line.includes("$"))).toHaveLength(1); expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
  expect(formatSession(session, ansiPalette, { rates, width, tokens: true }).map(stripVTControlCharacters)).toEqual(lines);
  expect(formatSession(session, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), { rates, width, tokens: true })).toEqual(lines);
  expect(session).toEqual(before);
});

it.each([zeroCost(), counted({ turns: 0, apiCalls: 4 }), counted({ untokenedTurns: 1 }), counted({ turnTokens: [null] })])(
  "keeps unavailable token and money evidence unknown: %j", cost => {
    const lines = render(record(cost)); expect(tableValues(lines, "cost")[0]).toBe("unknown");
    expect(tableValues(lines, "tokens")).toEqual(["unknown"]); expect(lines.join("\n")).not.toContain("$0.00");
  },
);

it("distinguishes measured zero and measured empty turns from absent capture", () => {
  const lines = render(record(counted({ emptySource: "git", emptyTurnTokens: zeroTokens() }), { reality: [] }));
  expect(tableValues(lines, "cost")).toEqual(["$0.00"]); expect(tableValues(lines, "empty turns")).toEqual(["1"]);
  expect(tableValues(lines, "no edits")).toEqual(["$0.00"]);
  const absent = render(record(zeroCost(), { reality: [] }));
  for (const field of ["turns", "calls", "empty turns", "no edits", "cost"]) expect(tableValues(absent, field)).toEqual(["unknown"]);
});

it("names unpriced models without supplying a dollar figure", () => {
  const lines = render(record(counted({ model: "missing", inputTokens: 10 })));
  expect(tableValues(lines, "cost")).toEqual(["unknown", "10 tokens, missing unpriced"]);
  expect(lines.join("\n")).not.toContain("$");
});

it("prices models separately and keeps their shared cost combined", () => {
  const a = { inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
  const b = { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 200_000 };
  const session = record(counted({ ...a, outputTokens: b.outputTokens, turns: 2, agents: ["a", "b"], modelTokens: { priced: a, second: b } }));
  const lines = render(session); expect(tableValues(lines, "models")).toEqual(["priced", "second"]);
  expect(tableValues(lines, "cost")).toEqual(["$1.60"]); expect(lines.filter(line => line.includes("$"))).toHaveLength(1);
  const shared = record({ ...session.cost, turnModels: ["priced"] });
  expect(tableValues(render(shared), "models")).toEqual(["priced", "second"]);
});

it("retains rate provenance only for a priced figure when tokens were requested", () => {
  const lines = formatSession(record(), plainPalette, { rates, width: 80, tokens: true, checked: "2026-10-17\u001b[2J" });
  const values = tableValues(lines, "cost"); expect(values[0]).toBe("$0.00");
  let remaining = "prices checked 2026-10-17 — override in ~/.session/rates.json";
  for (const part of values.slice(1)) { expect(remaining.startsWith(part)).toBe(true); remaining = remaining.slice(part.length).trimStart(); }
  expect(remaining).toBe("");
  expect(formatSession(record(), plainPalette, { rates, width: 80, checked: "2026-10-17" }).join("\n")).not.toContain("prices checked");
});

it("shows a measured call count only when every named adapter reports it", () => {
  const agents = [{ name: "a", reportsCalls: true, recognises: () => false }];
  const session = record(counted({ apiCalls: 4, agents: ["a"] }));
  expect(tableValues(formatSession(session, plainPalette, { rates, width: 80, agents }), "calls")).toEqual(["4"]);
  const shared = record({ ...session.cost, agents: ["a", "b"] });
  expect(tableValues(formatSession(shared, plainPalette, { rates, width: 80, agents }), "calls")).toEqual(["unknown"]);
});

it("refuses incomplete mixed-model rates and absent rates without a false zero", () => {
  const tokens = { inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
  const session = record(counted({ ...tokens, inputTokens: 200_000, modelTokens: { priced: tokens, second: tokens } }));
  const lines = formatSession(session, plainPalette, { rates: new Map([["priced", rates.get("priced")!]]), width: 80 });
  expect(tableValues(lines, "cost")[0]).toBe("unknown"); expect(lines.join("\n")).not.toContain("$");
  expect(tableValues(formatSession(record(), plainPalette, { width: 80 }), "cost")).toEqual(["unknown"]);
});
