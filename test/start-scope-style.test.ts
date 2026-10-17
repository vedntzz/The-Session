import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatScopePrompt } from "../src/render/terminal/start-scope.js";
import { cellWidth } from "../src/render/tui/text.js";

it("keeps every scope instruction readable in 40 columns, with or without styling", () => {
  const plain = formatScopePrompt();
  const styled = formatScopePrompt(ansiPalette);
  expect(styled.map(stripVTControlCharacters)).toEqual(plain);
  expect(plain.every(line => cellWidth(line) <= 40)).toBe(true);
  expect(plain.join("\n")).toContain("Empty line to finish or skip.");
  expect(plain.join("\n")).toContain("Ctrl-C to cancel");
  expect(plain.join("\n")).not.toContain("\u001b");
});

it("emphasizes optional scope and ends styling before typed paths", () => {
  const lines = formatScopePrompt(ansiPalette);
  expect(lines).toContain("  " + ansiPalette.intent("Scope (optional)"));
  expect(lines).toContain("  " + ansiPalette.meta("One file or folder prefix per line."));
  expect(lines.at(-1)).toBe("  › ");
  expect(formatScopePrompt(plainPalette)).toEqual(formatScopePrompt());
});
