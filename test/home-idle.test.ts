import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatHome } from "../src/render/terminal.js";
import { cellWidth } from "../src/render/tui/text.js";

const last = (overrides: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the UI", scope: [], baseline: [], reality: [], drift: [],
  cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: new Date(2026, 0, 15, 14, 2).toISOString(), endedAt: new Date(2026, 0, 15, 14, 39).toISOString(), ...overrides,
});
it("shows ready state and only the two starting commands", () => {
  const lines = formatHome({});
  expect(lines).toContain("  ◔ session  ready");
  expect(lines).toContain("  state       No sessions recorded in this repo yet.");
  expect(lines.at(-2)).toBe("  next        session start");
  expect(lines.at(-1)).toBe("              session hook install");
});
it("uses a factual closed reason when no intent was recorded", () => {
  const lines = formatHome({ last: last({ intent: null, intentSource: "captured" }) });
  expect(lines).toContain("  prompt      unknown"); expect(lines).toContain("              no intent recorded");
  expect(lines.join("\n")).not.toContain("recorded yet");
});

it("shows stopped facts, dim unknown cost and only the two next commands", () => {
  const lines = formatHome({ last: last() });
  expect(lines).toContain("  ◔ session  stopped"); expect(lines).toContain("  state       Nothing is recording.");
  expect(lines).toContain("  intent      Build the UI"); expect(lines).toContain("  last        abcdef01");
  expect(lines).toContain("  ended       14:39"); expect(lines).toContain("  cost        unknown");
  expect(lines.at(-2)).toBe("  next        session week last"); expect(lines.at(-1)).toBe("              session start");
  const tagged = formatHome({ last: last() }, { ...plainPalette, meta: (text) => `<meta>${text}</meta>` }).join("\n");
  expect(tagged).toContain("<meta>◔ session  stopped</meta>"); expect(tagged).toContain("<meta>unknown</meta>");
});
const rates = new Map([["priced", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }]]);
it.each([["priced", 0, 100_000, "unknown"], ["missing", 1, 100_000, "unknown"],
  ["priced", 1, 0, "$0.00"], ["priced", 1, 100_000, "$1.50"]] as const)("prices model %s with %i measured turns", (model, turns, inputTokens, figure) => {
  const cost = { ...zeroCost(), model, turns, inputTokens };
  expect(formatHome({ last: last({ cost }) }, plainPalette, { rates })).toContain(`  cost        ${figure}`);
});
it.each([60, 80, undefined])("keeps full safe intent and ANSI geometry at width %s", (width) => {
  const intent = "Keep every declared word visible without adding punctuation. ".repeat(4).trim();
  const record = last({ intent: `\u001b[2J${intent}`, intentSource: "primed" }); const before = JSON.stringify(record);
  const seen: string[] = []; const ink = (text: string) => { seen.push(text); return text; };
  const plain = formatHome({ last: record }, { ...plainPalette, intent: ink }, { width });
  const first = plain.findIndex((line) => line.startsWith("  intent      "));
  const end = plain.findIndex((line) => line.startsWith("  last        "));
  expect(plain.slice(first, end).map((line) => line.slice(14)).join(" ")).toBe(intent);
  expect(seen.join("\n")).not.toContain("\u001b"); expect(JSON.stringify(record)).toBe(before);
  expect(formatHome({ last: record }, ansiPalette, { width }).map(stripVTControlCharacters)).toEqual(plain);
  if (width !== undefined) expect(plain.every((line) => cellWidth(line) <= width)).toBe(true);
  else expect(plain[first]).toBe(`  intent      ${intent}`);
});
it("keeps the captured newline boundary and paste-only reason", () => {
  const captured = last({ intent: "First \u001b[2Jline\nSecond line.", intentSource: "captured" });
  const lines = formatHome({ last: captured }); expect(lines).toContain("  prompt      First line …");
  expect(lines.join("\n")).not.toContain("Second line");
  const pasted = last({ intent: null, intentSource: "captured", intentMissing: "paste-only" });
  expect(formatHome({ last: pasted })).toContain("              the first prompt was pasted text, not captured");
});
it("gives running work precedence over the last finished session", () => {
  const running = last({ endedAt: null });
  expect(formatHome({ running, last: last() })).toEqual(formatHome({ running }));
});
