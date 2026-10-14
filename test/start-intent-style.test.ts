import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatIntentPrompt } from "../src/render/terminal/start-intent.js";
import { cellWidth } from "../src/render/tui/text.js";

it("emphasizes the declaration heading and keeps the question in the foreground", () => {
  const lines = formatIntentPrompt(ansiPalette);
  expect(lines[0]).toBe("  " + ansiPalette.intent("Intent"));
  expect(lines[1]).toBe("  What are you working on?");
  expect(lines[3]).toBe("  " + ansiPalette.meta("Enter to continue · Ctrl-C to cancel"));
  expect(lines.at(-1)).toBe("  › ");
});

it("preserves the plain prompt and 40-column layout when ANSI styling is stripped", () => {
  const plain = formatIntentPrompt(plainPalette);
  expect(formatIntentPrompt()).toEqual(plain);
  expect(plain.join("\n")).not.toContain("\u001b");
  const stripped = formatIntentPrompt(ansiPalette).map(stripVTControlCharacters);
  expect(stripped).toEqual(plain);
  expect(stripped.every(line => cellWidth(line) <= 40)).toBe(true);
});
