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
/** Start's rows for one path at this width, with the label column and continuation indent taken off. */
const startPathRows = (path: string, width: number) =>
  startScopeRows([path], plainPalette, width).map((line, index) => line.slice(index === 0 ? 14 : 16));

it.each([40, 60])("wraps a scope path in home and stop as start does, at %i columns", (width) => {
  const start = startPathRows(spaced, width);
  const home = formatHome({ running: session({ endedAt: null }) }, plainPalette, { width });
  const stop = formatStopConfirmation(session(), plainPalette, [], width);
  expect(start.length).toBeGreaterThan(1);
  // Home and stop draw tables at a known width; their cells drop padding, so start's rows are compared without trailing space.
  expect(tableValues(home, "scope")).toEqual(start.map((row) => row.trimEnd()));
  expect(tableValues(stop, "scope")).toEqual(start.map((row) => row.trimEnd()));
  expect(start.join("")).toBe(spaced);
  expect([...home, ...stop].every((line) => cellWidth(line) <= width)).toBe(true);
});

it("keeps every character of changed and outside paths in stop", () => {
  const stop = formatStopConfirmation(session(), plainPalette, [], 40);
  const other = "outside dir/a long file name.ts";
  // A padded cell cannot show a trailing space, so each path's rows are held to start's, which join back to the whole path.
  expect(startPathRows(spaced, 40).join("")).toBe(spaced);
  expect(startPathRows(other, 40).join("")).toBe(other);
  const changed = [...startPathRows(spaced, 40), ...startPathRows(other, 40)].map((row) => row.trimEnd());
  expect(tableValues(stop, "changed")).toEqual(["2 files", ...changed]);
  expect(tableValues(stop, "outside")).toEqual(["1 file", "! outside dir/a long", "  file name.ts"]);
  expect(stop.every((line) => cellWidth(line) <= 40)).toBe(true);
});
