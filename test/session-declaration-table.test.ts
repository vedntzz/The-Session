import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatSession } from "../src/render/terminal/session.js";
import { cellWidth } from "../src/render/tui/text.js";
import { tableValues } from "./fixtures/table.js";

const record = (fields: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the terminal UI", scope: ["src/"], baseline: [],
  reality: ["src/panel.ts"], drift: [], cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: new Date(2026, 0, 15, 14, 2).toISOString(), endedAt: new Date(2026, 0, 15, 14, 39).toISOString(), ...fields,
});

it.each([40, 60, 80])("keeps the whole declaration and captured prompt at %i columns", width => {
  const intent = "Keep 界e\u0301 every word. Preserve the second sentence.\n" + "Keep the full prompt visible. ".repeat(7).trim();
  for (const intentSource of ["declared", "captured"] as const) {
    const session = record({ intent, intentSource }); const before = structuredClone(session);
    const lines = formatSession(session, plainPalette, { width }); const name = intentSource === "declared" ? "intent" : "prompt";
    expect(tableValues(lines, name).join(" ")).toBe(intent.replace(/\s+/gu, " "));
    expect(tableValues(lines, "time")).toEqual(["14:02 → 14:39"]);
    expect(tableValues(lines, "outcome")).toEqual(["open"]);
    expect(new Set(lines.filter(line => /^  [│╭╰├]/u.test(line)).map(cellWidth))).toEqual(new Set([width]));
    expect(session).toEqual(before);
  }
});

it.each(["open", "merged", "abandoned", "empty"] as const)("shows the caller-resolved %s outcome first", outcome => {
  const lines = formatSession(record({ outcome }), plainPalette, { width: 80 });
  expect(tableValues(lines, "outcome")).toEqual([outcome]);
  expect(lines.findIndex(line => /│ outcome /u.test(line))).toBeLessThan(lines.findIndex(line => /│ intent /u.test(line)));
});

it.each(["captured", "primed"] as const)("retains the %s source note", intentSource => {
  const lines = formatSession(record({ intentSource }), plainPalette, { width: 80 });
  expect(tableValues(lines, "source")).toEqual([intentSource === "captured"
    ? "captured from the first prompt, not declared" : "scope reviewed with Prime"]);
});

it.each([
  [null, undefined, "no intent recorded yet"], ["ended", undefined, "no intent recorded"],
  ["ended", "paste-only", "the first prompt was pasted text, not captured"],
] as const)("keeps missing prompt evidence explicit: %s/%s", (end, intentMissing, reason) => {
  const session = record({ intent: null, intentSource: "captured", intentMissing, ...(end === null ? { endedAt: null } : {}) });
  const lines = formatSession(session, plainPalette, { width: 80 });
  expect(tableValues(lines, "prompt")).toEqual(["unknown", reason]);
  if (end === null) expect(tableValues(lines, "time")).toEqual(["14:02 → still running"]);
});

it.each([40, 80])("sanitizes before ink and retains colorless geometry at %i columns", width => {
  const session = record({ intent: "Build\u001b[2J safely" }); const before = structuredClone(session); const seen: string[] = [];
  const lines = formatSession(session, { ...plainPalette, intent: text => { seen.push(text); return text; } }, { width });
  expect(tableValues(lines, "intent")).toEqual(["Build safely"]); expect(seen.join("\n")).not.toContain("\u001b");
  expect(formatSession(session, ansiPalette, { width }).map(stripVTControlCharacters)).toEqual(lines);
  expect(formatSession(session, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), { width })).toEqual(lines);
  expect(session).toEqual(before);
});

it("leaves the plain declaration, paths and footer unchanged", () => {
  const lines = formatSession(record());
  expect(lines.some(line => /[│╭╰├]/u.test(line))).toBe(false);
  expect(lines[1]).toMatch(/^  Build the terminal UI\s+14:02 → 14:39$/u);
  expect(lines).toContain("  outcome     open"); expect(lines).toContain("  declared    src/");
  expect(lines).toContain("  changed     src/panel.ts"); expect(lines).toContain("  id          abcdef01");
});
