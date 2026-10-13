import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { startScopeRows } from "../src/render/terminal/start-rows.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";
import { cellWidth } from "../src/render/tui/text.js";
import { withoutStartFrame } from "./fixtures/start.js";

const session = { intent: "Update the terminal", scope: [], id: "abcdef01-2345", startCommit: "123456789abc" };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => [...segmenter.segment(text)].map(part => part.segment);
const literals = [
  "資料/" + "e\u0301界".repeat(35) + "[draft]*,.ts",
  "src/" + "feature  draft/".repeat(10) + "file name.ts",
  "資料/" + "cafe\u0301  界/".repeat(15) + "[draft]*, file.ts",
];

it.each([40, 60, 80].flatMap(width => literals.map(literal => [width, literal] as const)))(
  "preserves every literal path character and grapheme at %i columns: %s", (width, literal) => {
    for (const palette of [plainPalette, ansiPalette]) {
      const rows = startScopeRows([literal, "notes/next.ts"], palette, width, 4).map(stripVTControlCharacters);
      const fragments = rows.slice(0, -1).map((line, index) => line.slice(index === 0 ? 14 : 16));
      expect(fragments.join("")).toBe(literal);
      expect(fragments.flatMap(graphemes)).toEqual(graphemes(literal));
      expect(rows.every(line => cellWidth(line) <= width - 4)).toBe(true);
      expect(rows.at(-1)).toBe("              notes/next.ts");
    }
  },
);

it.each([40, 60, 80])("keeps Unicode intent complete and frame edges aligned at %i columns", width => {
  const intent = "更新e\u0301界".repeat(40);
  const record = { ...session, intent, scope: [literals[2]!] };
  const lines = formatStartConfirmation(record, plainPalette, [], width);
  const content = withoutStartFrame(lines);
  const start = content.findIndex(line => line.startsWith("  intent      "));
  const scope = content.findIndex(line => line.startsWith("  scope       "));
  const fragments = content.slice(start, scope).map(line => line.slice(14));
  expect(fragments.join("")).toBe(intent);
  expect(fragments.flatMap(graphemes)).toEqual(graphemes(intent));
  expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
  expect(formatStartConfirmation(record, ansiPalette, [], width).map(stripVTControlCharacters)).toEqual(lines);
});

it.each(literals)("keeps literal Unicode and spaces whole without a terminal width: %s", literal => {
  const lines = formatStartConfirmation({ ...session, scope: [literal] });
  expect(lines).toContain("  scope       " + literal);
  expect(lines.some(line => line.includes("│"))).toBe(false);
});
