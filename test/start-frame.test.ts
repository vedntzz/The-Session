import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";
import { cellWidth } from "../src/render/tui/text.js";

const session = { intent: "Add retries", scope: ["src/webhooks/"], id: "abcdef01-2345", startCommit: "123456789abc" };

it.each([60, 80])("frames the recording header at %i columns and retains the existing rows", width => {
  const lines = formatStartConfirmation(session, plainPalette, [], width);
  expect(lines[0]).toMatch(/^  ╭─+╮$/u);
  expect(lines[1]).toMatch(/^  │ ◔ session  RECORDING +│$/u);
  expect(lines[2]).toMatch(/^  ╰─+╯$/u);
  expect(lines.slice(0, 3).map(cellWidth)).toEqual([width, width, width]);
  expect(lines.slice(3)).toEqual(formatStartConfirmation(session).slice(1));
});

it.each([60, 80])("keeps ANSI and NO_COLOR frame geometry identical at %i columns", width => {
  const plain = formatStartConfirmation(session, plainPalette, [], width);
  const colored = formatStartConfirmation(session, ansiPalette, [], width);
  expect(colored.map(stripVTControlCharacters)).toEqual(plain);
  expect(colored[1]).toContain("\u001b[36m");
  expect(formatStartConfirmation(session, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), [], width)).toEqual(plain);
});

it.each([20, 0, -1])("uses the existing width floor for a %i-column frame", width => {
  expect(formatStartConfirmation(session, plainPalette, [], width)).toEqual(formatStartConfirmation(session, plainPalette, [], 60));
});

it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])("omits frame decoration when width is unavailable: %s", width => {
  expect(formatStartConfirmation(session, plainPalette, [], width)[0]).toBe("  ◔ session  RECORDING");
});
