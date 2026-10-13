import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";
import { cellWidth } from "../src/render/tui/text.js";
import { startScopeRows } from "../src/render/terminal/start-rows.js";
import { withoutStartFrame } from "./fixtures/start.js";

const intent = "Keep every word from the recorded declaration visible. ".repeat(5).trim();
const session = { intent, scope: ["src/a file.ts"], id: "abcdef01-2345", startCommit: "123456789abc" };
function section(lines: string[], first: string, next: string) {
  const content = withoutStartFrame(lines);
  return content.slice(content.findIndex((line) => line.startsWith(first)), content.findIndex((line) => line.startsWith(next)));
}

it.each([60, 80])("wraps full intent at %i columns under the value column", (width) => {
  const lines = formatStartConfirmation(session, plainPalette, [], width);
  const values = section(lines, "  intent      ", "  scope       ");
  expect(values.length).toBeGreaterThan(1);
  expect(values.slice(1).every((line) => line.startsWith("              "))).toBe(true);
  expect(values.map((line) => line.slice(14)).join(" ")).toBe(intent);
  expect(lines.every((line) => cellWidth(line) <= width)).toBe(true);
});

it("indents wrapped path fragments further than the next declared path", () => {
  const literal = `src/${"a".repeat(90)}.ts`;
  const lines = formatStartConfirmation({ ...session, scope: [literal, "notes/second.ts"] }, plainPalette, [], 60);
  const paths = section(lines, "  scope       ", "  id          ");
  expect(paths[0]).toMatch(/^  scope       src\//);
  expect(paths.slice(1, -1).every((line) => line.startsWith("                "))).toBe(true);
  expect(paths.at(-1)).toBe("              notes/second.ts");
});

it.each([60, 80].flatMap((width) => [
  [width, `資料/${"e\u0301界".repeat(40)}.ts`, ""],
  [width, `src/${"folder  ".repeat(15)}file.ts`, " "],
] as const))("preserves literal graphemes and spaces at %i columns: %s", (width, literal, separator) => {
  const lines = formatStartConfirmation({ ...session, scope: [literal, "notes/[draft]*, a.ts"] }, plainPalette, [], width);
  // Literal spaces are checked before frame padding makes them visually indistinguishable.
  const paths = startScopeRows([literal, "notes/[draft]*, a.ts"], plainPalette, width, 4);
  const values = paths.slice(0, -1).map((line, index) => line.slice(index === 0 ? 14 : 16));
  expect(values.length).toBeGreaterThan(1);
  expect(values.join(separator)).toBe(literal);
  expect(values.every((value) => !/^\p{Mark}/u.test(value))).toBe(true);
  expect(paths.at(-1)).toBe("              notes/[draft]*, a.ts");
  expect(lines.every((line) => cellWidth(line) <= width)).toBe(true);
});

it.each([60, 80])("retains full safe metadata at %i columns", (width) => {
  const detail = `  attribution  ${"Read all accepted metadata safely. ".repeat(7).trim()}\u001b[2J`;
  const lines = formatStartConfirmation(session, plainPalette, [detail], width);
  const details = lines.slice(lines.findIndex((line) => line.startsWith("  head        ")) + 1, -2);
  expect(details.length).toBeGreaterThan(1);
  expect(details.every((line) => line.startsWith("  "))).toBe(true);
  expect(details.map((line) => line.slice(2)).join(" ")).toBe(stripVTControlCharacters(detail).slice(2));
  expect(lines.join("\n")).not.toContain("\u001b");
  expect(lines.every((line) => cellWidth(line) <= width)).toBe(true);
});

it("sanitizes control text before wrapping and applying ink", () => {
  const seen: string[] = []; const safe = "a".repeat(45) + "b".repeat(45);
  const palette = { ...plainPalette, intent: (text: string) => { seen.push(text); return text; } };
  const lines = formatStartConfirmation({ ...session, intent: `${"a".repeat(45)}\u001b[2J${"b".repeat(45)}` }, palette, [], 60);
  expect(seen.join("")).toBe(safe); expect(seen.every((value) => cellWidth(value) <= 46)).toBe(true);
  expect(section(lines, "  intent      ", "  scope       ").map((line) => line.slice(14)).join("")).toBe(safe);
});

it.each([60, 80])("keeps plain, ANSI and NO_COLOR geometry identical at %i columns", (width) => {
  const plain = formatStartConfirmation(session, plainPalette, [], width);
  expect(formatStartConfirmation(session, ansiPalette, [], width).map(stripVTControlCharacters)).toEqual(plain);
  expect(formatStartConfirmation(session, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), [], width)).toEqual(plain);
});

it("preserves unlimited legacy rows when width is absent", () => {
  const long = { ...session, scope: [`src/${"z".repeat(120)}.ts`] };
  const lines = formatStartConfirmation(long);
  expect(lines).toContain(`  intent      ${intent}`); expect(lines).toContain(`  scope       ${long.scope[0]}`);
  expect(formatStartConfirmation(long, plainPalette, [], undefined)).toEqual(lines);
});

it("clamps narrow terminals to the floor and keeps the footer command whole", () => {
  const lines = formatStartConfirmation(session, plainPalette, [], 60);
  expect(formatStartConfirmation(session, plainPalette, [], 20)).toEqual(lines);
  expect(lines.at(-1)).toBe("  next        Work in your editor, then run session stop.");
});
