import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";
import { cellWidth } from "../src/render/tui/text.js";
import { withoutStartFrame } from "./fixtures/start.js";

const session = { intent: "Add retries", scope: ["src/webhooks/"], id: "abcdef01-2345", startCommit: "123456789abc" };

it.each([60, 80])("frames recorded intent and scope at %i columns", width => {
  const lines = formatStartConfirmation(session, plainPalette, [], width);
  const end = lines.findIndex(line => /^  ╰─+╯$/u.test(line));
  expect(lines[0]).toMatch(/^  ╭─+╮$/u);
  expect(lines[1]).toMatch(/^  │ ◔ session +RECORDING │$/u);
  expect(lines.slice(2, end).some(line => line.startsWith("  │ intent      Add retries"))).toBe(true);
  expect(lines.slice(2, end).some(line => line.startsWith("  │ scope       src/webhooks/"))).toBe(true);
  expect(lines.slice(0, end + 1).every(line => cellWidth(line) === width)).toBe(true);
  expect(withoutStartFrame(lines).slice(1)).toEqual(formatStartConfirmation(session).slice(1));
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

it.each([60, 80, 120])("fits long declarations, literal paths and Unicode inside a %i-column terminal", width => {
  const long = { ...session, intent: "Keep every word visible. ".repeat(8).trim(), scope: ["資料/" + "e\u0301界".repeat(40) + ".ts", "src/" + "folder  ".repeat(15) + "file.ts"] };
  const lines = formatStartConfirmation(long, plainPalette, [], width);
  const end = lines.findIndex(line => /^  ╰─+╯$/u.test(line));
  const framed = lines.slice(0, end + 1);
  expect(framed.length).toBeGreaterThan(6);
  expect(framed.every(line => cellWidth(line) === Math.min(width, 80))).toBe(true);
  expect(framed.slice(1, -1).every(line => /^  ├─+┤$/u.test(line) || (line.startsWith("  │ ") && line.endsWith(" │")))).toBe(true);
});

it("keeps unknown intent and an undeclared scope explicit inside the frame", () => {
  const lines = formatStartConfirmation({ ...session, intent: null, scope: [] }, plainPalette, [], 60);
  const end = lines.findIndex(line => /^  ╰─+╯$/u.test(line));
  expect(lines.slice(2, end).some(line => line.startsWith("  │ intent      unknown"))).toBe(true);
  expect(lines.slice(2, end).some(line => line.startsWith("  │ scope       none declared"))).toBe(true);
});

it.each([60, 80])("places the recorded ID and commit below a divider at %i columns", width => {
  const saved = { ...session, id: "fedcba98-7654", startCommit: "d3adc0ffeebabbe" };
  const lines = formatStartConfirmation(saved, plainPalette, [], width);
  const scope = lines.findIndex(line => line.startsWith("  │ scope"));
  const divider = lines.findIndex(line => /^  ├─+┤$/u.test(line));
  const id = lines.findIndex(line => line.startsWith("  │ id          fedcba98"));
  const head = lines.findIndex(line => line.startsWith("  │ head        d3adc0f"));
  const end = lines.findIndex(line => /^  ╰─+╯$/u.test(line));
  expect(divider).toBeGreaterThan(scope);
  expect(id).toBeGreaterThan(divider);
  expect(head).toBeGreaterThan(id);
  expect(head).toBeLessThan(end);
  expect(lines.slice(0, end + 1).every(line => cellWidth(line) === width)).toBe(true);
  expect(withoutStartFrame(lines).slice(1)).toEqual(formatStartConfirmation(saved).slice(1));
});

it.each([60, 80])("places readable work and finish guidance after the saved record at %i columns", width => {
  const lines = formatStartConfirmation(session, plainPalette, [], width);
  const end = lines.findIndex(line => /^  ╰─+╯$/u.test(line));
  const next = lines.indexOf("  next        Work in your coding tool.");
  const finish = lines.indexOf("  finish      session stop");
  expect(next).toBeGreaterThan(end);
  expect(finish).toBeGreaterThan(next);
  expect(lines.filter(line => line.includes("session stop"))).toHaveLength(1);
  expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
});

it.each([60, 80])("uses readable foreground text while keeping frame edges quiet at %i columns", width => {
  const lines = formatStartConfirmation(session, ansiPalette, [], width);
  const prefix = "  " + ansiPalette.meta("│ "); const suffix = ansiPalette.meta(" │");
  const fields = lines.filter(line => line.startsWith(prefix) && /intent|scope|src\/webhooks|abcdef01|1234567/u.test(line));
  expect(fields).toHaveLength(4);
  expect(fields.every(line => !line.slice(prefix.length, -suffix.length).includes("\u001b[2m"))).toBe(true);
  expect(lines.find(line => line.includes("Your intent is recorded"))).not.toContain("\u001b[2m");
});
