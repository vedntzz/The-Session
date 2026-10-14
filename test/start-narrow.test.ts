import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";
import { startScopeRows } from "../src/render/terminal/start-rows.js";
import { MIN_WIDTH, terminalWidth } from "../src/render/terminal/text.js";
import { cellWidth } from "../src/render/tui/text.js";
import { withoutStartFrame } from "./fixtures/start.js";

const session = { intent: "Add retries to the webhook sender", scope: ["src/webhooks/"], id: "abcdef01-2345", startCommit: "123456789abc" };

it.each([40, 60, 80])("fits the complete saved confirmation and metadata at %i columns", width => {
  const details = ["  attribution  Read the full recorded metadata safely. ".repeat(3).trimEnd()];
  const before = structuredClone(session);
  const lines = formatStartConfirmation(session, plainPalette, details, width);
  const end = lines.findIndex(line => /^  ╰─+╯$/u.test(line));
  expect(lines.slice(0, end + 1).every(line => cellWidth(line) === width)).toBe(true);
  expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
  expect(withoutStartFrame(lines)).toContain("  finish      session stop");
  expect(session).toEqual(before);
});

it("keeps the whole declaration and next steps readable at 40 columns", () => {
  const lines = withoutStartFrame(formatStartConfirmation(session, plainPalette, [], 40));
  const intent = lines.findIndex(line => line.startsWith("  intent      "));
  const scope = lines.findIndex(line => line.startsWith("  scope       "));
  expect(lines.slice(intent, scope).map(line => line.slice(14)).join(" ")).toBe(session.intent);
  expect(lines).toContain("  scope       src/webhooks/");
  expect(lines).toContain("  id          abcdef01");
  expect(lines).toContain("  head        1234567");
  expect(lines).toContain("  Your intent is recorded and stays");
  expect(lines).toContain("  fixed.");
});

it("lets start request a narrower minimum without changing table or pipe widths", () => {
  const tty = { isTTY: true, columns: 40 };
  expect(terminalWidth(tty, 40)).toBe(40);
  expect(terminalWidth(tty)).toBe(MIN_WIDTH);
  expect(terminalWidth({ isTTY: false, columns: 40 }, 40)).toBeUndefined();
});

it("keeps color optional at 40 columns and makes missing declarations explicit", () => {
  const missing = { ...session, intent: null, scope: [] };
  const plain = formatStartConfirmation(missing, plainPalette, [], 40);
  expect(formatStartConfirmation(missing, ansiPalette, [], 40).map(stripVTControlCharacters)).toEqual(plain);
  expect(formatStartConfirmation(missing, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), [], 40)).toEqual(plain);
  expect(withoutStartFrame(plain)).toContain("  intent      unknown");
  expect(withoutStartFrame(plain)).toContain("  scope       none declared");
  expect(plain.every(line => cellWidth(line) <= 40)).toBe(true);
});

it("preserves long intent and literal path text when wrapping at 40 columns", () => {
  const intent = "Keep every recorded word visible. ".repeat(8).trim();
  const literal = "src/" + "long-directory/".repeat(8) + "filename.ts";
  const lines = formatStartConfirmation({ ...session, intent, scope: [literal] }, plainPalette, [], 40);
  const content = withoutStartFrame(lines);
  const first = content.findIndex(line => line.startsWith("  intent      "));
  const scope = content.findIndex(line => line.startsWith("  scope       "));
  expect(content.slice(first, scope).map(line => line.slice(14)).join(" ")).toBe(intent);
  const paths = startScopeRows([literal], plainPalette, 40, 4);
  expect(paths.map((line, index) => line.slice(index === 0 ? 14 : 16)).join("")).toBe(literal);
  expect(lines.every(line => cellWidth(line) <= 40)).toBe(true);
});
