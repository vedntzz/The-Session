import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { plainPalette } from "../src/render/palette.js";
import { formatHome } from "../src/render/terminal.js";
import { startScopeRows } from "../src/render/terminal/start-rows.js";
import { formatStopConfirmation } from "../src/render/terminal/stop.js";
import { cellWidth } from "../src/render/tui/text.js";
import { tableValues } from "./fixtures/table.js";

const spaced = "docs/a very long folder name/with  two spaces inside/";
const session = (overrides: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Wrap paths", scope: [spaced], baseline: [], reality: [spaced, "outside dir/a long file name.ts"],
  drift: ["outside dir/a long file name.ts"], cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: "2026-01-15T14:02:00Z", endedAt: "2026-01-15T14:39:00Z", ...overrides,
});
/** The rows from `first` until the next labelled row, with the label column and continuation indent taken off. */
function pathRows(lines: string[], first: string, marker = ""): string[] {
  const at = lines.findIndex((line) => line.startsWith(`  ${first}`.padEnd(14) + marker));
  const end = lines.findIndex((line, index) => index > at && !line.startsWith("                "));
  return lines.slice(at, end).map((line, index) => line.slice(index === 0 ? 14 + marker.length : 16));
}

it.each([40, 60])("wraps a scope path in home and stop as start does, at %i columns", (width) => {
  const start = startScopeRows([spaced], plainPalette, width).map((line, index) => line.slice(index === 0 ? 14 : 16));
  const home = formatHome({ running: session({ endedAt: null }) }, plainPalette, { width });
  const stop = formatStopConfirmation(session(), plainPalette, [], width);
  expect(start.length).toBeGreaterThan(1);
  // Home draws a table at a known width; its cells drop padding, so start's rows are compared without trailing space.
  expect(tableValues(home, "scope")).toEqual(start.map((row) => row.trimEnd()));
  expect(pathRows(stop, "scope")).toEqual(start);
  expect(start.join("")).toBe(spaced);
  expect([...home, ...stop].every((line) => cellWidth(line) <= width)).toBe(true);
});

it("keeps every character of changed and outside paths in stop", () => {
  const stop = formatStopConfirmation(session(), plainPalette, [], 40);
  const block = (label: string) => {
    const at = stop.findIndex((line) => line.startsWith(`  ${label}`.padEnd(14)));
    const end = stop.findIndex((line, index) => index > at && !line.startsWith("              "));
    return stop.slice(at + 1, end).map((line) => line.slice(line.startsWith("                ") ? 16 : 14));
  };
  expect(block("changed").join("")).toBe(`${spaced}outside dir/a long file name.ts`);
  expect(block("outside").join("")).toBe("! outside dir/a long file name.ts");
  expect(stop.every((line) => cellWidth(line) <= 40)).toBe(true);
});
