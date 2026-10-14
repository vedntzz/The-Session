import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";
import { cellWidth } from "../src/render/tui/text.js";

const session = {
  intent: "Keep every recorded declaration word visible. ".repeat(6).trim(),
  scope: ["資料/cafe\u0301  draft/[x]*, sender.ts"],
  id: "abcdef01-2345", startCommit: "123456789abc",
};
const details = ["  attribution  " + "Read the complete recorded metadata. ".repeat(6).trim()];

it.each([[40, 40], [60, 60], [80, 80], [80.9, 80], [120, 80]])(
  "uses one %s-column terminal budget normalized to %i for the whole confirmation", (reported, width) => {
    const lines = formatStartConfirmation(session, plainPalette, details, reported);
    expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
    expect(lines).toEqual(formatStartConfirmation(session, plainPalette, details, width));
    expect(formatStartConfirmation(session, ansiPalette, details, reported).map(stripVTControlCharacters)).toEqual(lines);
  },
);

it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "keeps all legacy bytes when terminal width is unavailable: %s", width => {
    const expected = formatStartConfirmation(session, plainPalette, details);
    const actual = formatStartConfirmation(session, plainPalette, details, width);
    expect(actual).toEqual(expected);
    expect(actual).toContain("  intent      " + session.intent);
    expect(actual).toContain(details[0]);
    expect(actual.some(line => cellWidth(line) > 80)).toBe(true);
    expect(formatStartConfirmation(session, ansiPalette, details, width).map(stripVTControlCharacters)).toEqual(expected);
  },
);
