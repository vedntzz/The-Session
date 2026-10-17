import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatWeek } from "../src/render/terminal.js";
import { cellWidth } from "../src/render/tui/text.js";
import { zeroCost, type Session } from "../src/store.js";

function session(fields: Partial<Session> = {}): Session {
  return {
    id: "64c0696a-2222-3333-4444-555555555555", repo: "remote:acme/tool",
    intent: "Test the terminal UI", scope: ["src/"], baseline: [],
    reality: ["src/panel.ts", "outside.txt"], drift: ["outside.txt"],
    cost: zeroCost(), outcome: "open", startCommit: "abc",
    startedAt: "2026-10-17T15:24:00.000Z", endedAt: "2026-10-17T15:28:00.000Z",
    ...fields,
  };
}

const render = (sessions = [session()], width = 120): string[] =>
  formatWeek(sessions, 7, plainPalette, {}, { width });
const borders = (lines: string[]): string[] => lines.filter((line) => /[│╭╰├]/u.test(line));

describe("bordered week in a terminal", () => {
  it("labels the identity, time, outcome and every numeric column", () => {
    const lines = render();
    expect(lines.some((line) => line.startsWith("  ╭"))).toBe(true);
    const heading = lines.find((line) => line.includes("No edits"));
    for (const label of ["ID", "Started", "Outcome", "Outside", "Turns", "Cost"]) {
      expect(heading).toContain(label);
    }
    expect(lines.find((line) => line.includes("64c0696a")))
      .toMatch(/│ open\s+│\s+1 │\s+unknown │\s+unknown │\s+unknown │/u);
  });

  it("keeps the default grid within 80 columns with aligned edges", () => {
    const lines = borders(render([session()], 80));
    expect(new Set(lines.map(cellWidth)).size).toBe(1);
    expect(lines.every((line) => cellWidth(line) <= 80)).toBe(true);
  });

  it("wraps a full declaration, including wide and combining characters", () => {
    const intent = "Build 界e\u0301 " + "readable terminal tables ".repeat(12) + "last word";
    const lines = render([session({ intent })], 80);
    const words = lines.filter((line) => line.startsWith("  │ ") && !line.includes("64c0696a") && !line.includes("No edits"));
    expect(words.map((line) => line.slice(4, -2).trim()).join(" ")).toBe(intent);
    expect(new Set(borders(lines).map(cellWidth)).size).toBe(1);
  });

  it("preserves optional figures and their exact recorded value", () => {
    const cost = { ...zeroCost(), turns: 2, inputTokens: 84_200, model: "test" };
    const rates = new Map([["test", { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 }]]);
    const lines = formatWeek([session({ cost })], 7, plainPalette, {}, { width: 120, tokens: true, classes: true, rates });
    expect(lines.find((line) => line.includes("No edits"))).toMatch(/Class.*Tokens/u);
    expect(lines.find((line) => line.includes("64c0696a"))).toContain("84,200");
    expect(lines.find((line) => line.includes("64c0696a"))).toContain("$1.26");
  });

  it("renders the same geometry with colour and with colour disabled", () => {
    const sessions = [session({ outcome: "merged" }), session({ id: "aaaa1234" })];
    const plain = formatWeek(sessions, 7, plainPalette, {}, { width: 120 });
    const inked = formatWeek(sessions, 7, ansiPalette, {}, { width: 120 });
    expect(inked.map(stripVTControlCharacters)).toEqual(plain);
    expect(new Set(borders(plain).map(cellWidth)).size).toBe(1);
  });

  it("retains empty source blocks and explains missing cost without zero", () => {
    const text = render().join("\n");
    expect(text).toContain("primed · no sessions");
    expect(text).toContain("captured · no sessions");
    expect(text).toContain("1 session uncaptured");
    expect(text).not.toContain("$0.00");
  });

  it("only calls a session abandoned when a person recorded it", () => {
    const observation = { outcome: "abandoned" as const, observedAt: "2026-10-17T16:00:00.000Z", commit: "c", branch: "main" };
    const computed = session({ outcome: "abandoned", observations: [{ ...observation, source: "computed" }] });
    const manual = session({ id: "aaaa1234", outcome: "abandoned", observations: [{ ...observation, source: "manual" }] });
    const lines = render([computed, manual]);
    expect(lines.find((line) => line.includes("64c0696a"))).toContain("open");
    expect(lines.find((line) => line.includes("aaaa1234"))).toContain("abandoned");
  });

  it("keeps source grids separate with shared column widths", () => {
    const lines = render([session(), session({ id: "aaaa1234", intentSource: "captured", scope: [] })]);
    expect(lines.filter((line) => line.startsWith("  ╭"))).toHaveLength(2);
    expect(new Set(borders(lines).map(cellWidth)).size).toBe(1);
  });

  it("leaves piped output in its existing stable format", () => {
    const lines = formatWeek([session()], 7);
    expect(borders(lines)).toEqual([]);
    expect(lines).toContain("  Test the terminal UI");
  });

  it("does not alter the recorded session while rendering", () => {
    const sessions = [session()];
    const before = structuredClone(sessions);
    render(sessions);
    expect(sessions).toEqual(before);
  });
});
