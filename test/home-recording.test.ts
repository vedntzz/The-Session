import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatHome } from "../src/render/terminal.js";
import { cellWidth } from "../src/render/tui/text.js";

const running = (overrides: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the UI", scope: ["src/a file.ts", "notes/a,b*[draft].md"],
  baseline: [], reality: [], drift: [], cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: new Date(2026, 0, 15, 14, 2).toISOString(), endedAt: null, ...overrides,
});

it("shows the recording declaration as aligned rows with two next commands", () => {
  const lines = formatHome({ running: running() });
  expect(lines).toContain("  ◔ session  recording");
  expect(lines).toContain("  intent      Build the UI");
  expect(lines).toContain("  scope       src/a file.ts");
  expect(lines).toContain("              notes/a,b*[draft].md");
  expect(lines).toContain("  id          abcdef01"); expect(lines).toContain("  since       14:02");
  expect(lines.at(-2)).toMatch(/^  next        session stop(?:\s|$)/);
  expect(lines.at(-1)).toMatch(/^              session week(?:\s|$)/);
});

function rows(lines: string[], first: string, next: string) {
  return lines.slice(lines.findIndex((line) => line.startsWith(first)), lines.findIndex((line) => line.startsWith(next)));
}
it.each([60, 80, undefined].flatMap((width) => (["declared", "primed", undefined] as const).map((source) => [width, source] as const)))(
  "keeps full declarations and literal scope at width %s with source %s", (width, source) => {
    const intent = "Keep every declared word visible without adding punctuation. ".repeat(4).trim();
    const literal = `資料/${"e\u0301界".repeat(40)}.ts`;
    const record = running({ intent, intentSource: source, scope: [literal, "notes/[draft]*, a  file.ts"] });
    const before = JSON.stringify(record); const lines = formatHome({ running: record }, plainPalette, { width });
    expect(rows(lines, "  intent      ", "  scope       ").map((line) => line.slice(14)).join(" ")).toBe(intent);
    const scope = rows(lines, "  scope       ", "  id          ");
    expect(scope.slice(0, -1).map((line, index) => line.slice(index ? 16 : 14)).join("")).toBe(literal);
    expect(scope.at(-1)).toBe("              notes/[draft]*, a  file.ts");
    expect(scope.slice(1, -1).every((line) => line.startsWith("                ") && !/^\p{Mark}/u.test(line.slice(16)))).toBe(true);
    if (width !== undefined) expect(lines.every((line) => cellWidth(line) <= width)).toBe(true);
    expect(JSON.stringify(record)).toBe(before);
  },
);
it("labels a captured first line as prompt and preserves its newline boundary", () => {
  const lines = formatHome({ running: running({ intent: "First \u001b[2Jline\nSecond line.", intentSource: "captured" }) });
  expect(lines).toContain("  prompt      First line …");
  expect(lines.join("\n")).not.toContain("Second line"); expect(lines.join("\n")).not.toContain("\u001b");
});
it("keeps a captured record's stale scope off the accepted declaration rows", () => {
  const record = running({ intentSource: "captured", scope: ["legacy/stale.ts"] }); const before = JSON.stringify(record);
  const lines = formatHome({ running: record }); expect(lines).toContain("  scope       none declared");
  expect(lines.join("\n")).not.toContain("legacy/stale.ts"); expect(JSON.stringify(record)).toBe(before);
});
it.each([undefined, "paste-only"] as const)("shows unknown with the correct reason %s", (intentMissing) => {
  const lines = formatHome({ running: running({ intent: null, intentSource: "captured", intentMissing, scope: [] }) });
  expect(lines).toContain("  prompt      unknown"); expect(lines).toContain("  scope       none declared");
  expect(lines).toContain(`              ${intentMissing ? "the first prompt was pasted text, not captured" : "no intent recorded yet"}`);
});
it("neutralizes intent and path controls before ink without changing the record", () => {
  const seen: string[] = []; const ink = (text: string) => { seen.push(text); return text; };
  const record = running({ intent: "Build\u001b[2J the UI", scope: ["src/a\u001b[2J file.ts"] });
  const before = JSON.stringify(record);
  const lines = formatHome({ running: record }, { ...plainPalette, intent: ink, path: ink });
  expect(lines).toContain("  intent      Build the UI"); expect(lines).toContain("  scope       src/a file.ts");
  expect(seen.join("\n")).not.toContain("\u001b"); expect(JSON.stringify(record)).toBe(before);
});
it.each([60, 80, undefined])("keeps ANSI and NO_COLOR geometry plain at width %s", (width) => {
  const record = running({ intent: "Keep the full declaration visible. ".repeat(5).trim() });
  const plain = formatHome({ running: record }, plainPalette, { width });
  const ansi = formatHome({ running: record }, ansiPalette, { width });
  expect(ansi.map(stripVTControlCharacters)).toEqual(plain); expect(ansi.join("\n")).toContain("\u001b[36m");
  expect(ansi.join("\n")).not.toMatch(/\u001b\[(?:4\d|10\d|48)(?:[;m])/);
  expect(formatHome({ running: record }, paletteFor({ isTTY: true, env: { NO_COLOR: "1" } }), { width })).toEqual(plain);
});
