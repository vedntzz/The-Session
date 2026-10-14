import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatStartPromptHeader } from "../src/render/terminal/start-prompt-header.js";
import { cellWidth } from "../src/render/tui/text.js";

it.each([[20, 40], [40, 40], [60, 60], [80.9, 80], [120, 80]])("fits the prompt header's %i-column budget to %i", (reported, expected) => {
  const plain = formatStartPromptHeader(plainPalette, reported);
  expect(cellWidth(plain[1]!)).toBe(expected);
  expect(plain.every(line => cellWidth(line) <= expected)).toBe(true);
  expect(formatStartPromptHeader(ansiPalette, reported).map(stripVTControlCharacters)).toEqual(plain);
});

it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])("uses a fixed header when width is unavailable: %s", width => {
  const lines = formatStartPromptHeader(plainPalette, width);
  expect(lines).toEqual(["  ◔ session  start a session", "  " + "─".repeat(78), ""]);
  expect(lines.join("\n")).not.toContain("RECORDING");
});
