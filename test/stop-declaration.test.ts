import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatStopConfirmation } from "../src/render/terminal/stop.js";
import { cellWidth } from "../src/render/tui/text.js";
import { zeroCost, type Session } from "../src/store.js";
import { tableValues } from "./fixtures/table.js";

const stopped = (fields: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the terminal UI", scope: ["src/"],
  baseline: [], reality: ["src/panel.ts"], drift: [], cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: "2026-10-17T15:24:00Z", endedAt: "2026-10-17T15:28:00Z", ...fields,
});

it.each([40, 60, 80])("frames the outcome before the complete declaration at %i columns", width => {
  const intent = "Preserve 界e\u0301 " + "every declared word ".repeat(9) + "last word.";
  const record = stopped({ intent }); const before = structuredClone(record);
  const lines = formatStopConfirmation(record, plainPalette, [], width);
  expect(tableValues(lines, "outcome")).toEqual(["open"]);
  expect(tableValues(lines, "intent").join(" ")).toBe(intent);
  const table = lines.filter(line => /[│╭╰├]/u.test(line));
  expect(new Set(table.map(cellWidth))).toEqual(new Set([width]));
  expect(table.findIndex(line => /│ outcome /u.test(line))).toBeLessThan(table.findIndex(line => /│ intent /u.test(line)));
  expect(record).toEqual(before);
});

it("uses the caller-resolved outcome without changing the signed record", () => {
  const record = stopped({ outcome: "open" }); const before = structuredClone(record);
  const lines = formatStopConfirmation(record, plainPalette, [], 80, { outcome: "merged" });
  expect(tableValues(lines, "outcome")).toEqual(["merged"]); expect(record).toEqual(before);
});

it("makes unavailable outcome evidence explicit", () => {
  const lines = formatStopConfirmation(stopped(), plainPalette, [], 80, { outcome: "unknown" });
  expect(tableValues(lines, "outcome")).toEqual(["unknown"]);
});

it("keeps the captured prompt boundary", () => {
  const record = stopped({ intent: "First line\nSecond line", intentSource: "captured" });
  const lines = formatStopConfirmation(record, plainPalette, [], 80);
  expect(tableValues(lines, "prompt")).toEqual(["First line …"]);
  expect(lines.join("\n")).not.toContain("Second line");
});

it.each([undefined, "paste-only"] as const)("shows unknown intent with its factual reason: %s", intentMissing => {
  const record = stopped({ intent: null, intentSource: "captured", intentMissing });
  const lines = formatStopConfirmation(record, plainPalette, [], 80);
  expect(tableValues(lines, "prompt")).toEqual(["unknown", intentMissing
    ? "the first prompt was pasted text, not captured" : "no intent recorded"]);
});

it("keeps table geometry independent of colour and sanitizes before ink", () => {
  const record = stopped({ intent: "Build\u001b[2J safely" });
  const plain = formatStopConfirmation(record, plainPalette, [], 40, { outcome: "merged" });
  const ansi = formatStopConfirmation(record, ansiPalette, [], 40, { outcome: "merged" });
  expect(ansi.map(stripVTControlCharacters)).toEqual(plain);
  expect(tableValues(plain, "intent")).toEqual(["Build safely"]);
  expect(plain.join("\n")).not.toContain("\u001b");
});

it("keeps recorded paths, evidence and next commands intact", () => {
  const record = stopped({ reality: ["src/panel.ts", "outside.txt"], drift: ["outside.txt"] });
  const lines = formatStopConfirmation(record, plainPalette, [], 80);
  expect(tableValues(lines, "scope")).toEqual(["src/"]); expect(tableValues(lines, "changed")[0]).toBe("2 files");
  expect(tableValues(lines, "outside")).toContain("! outside.txt"); expect(tableValues(lines, "id")).toEqual(["abcdef01"]);
  expect(tableValues(lines, "turns")).toEqual(["unknown"]); expect(tableValues(lines, "cost")).toEqual(["unknown"]);
  expect(lines).toContain("  next        session week last --full");
});

it("leaves the existing plain output unchanged without terminal width", () => {
  const lines = formatStopConfirmation(stopped());
  expect(lines).toContain("  outcome     open"); expect(lines).toContain("  intent      Build the terminal UI");
  expect(lines.some(line => /[│╭╰├]/u.test(line))).toBe(false);
});
