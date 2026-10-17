import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { plainPalette } from "../src/render/palette.js";
import { gridHeading, gridIntent, gridRow, gridRule, type GridColumn } from "../src/render/terminal/table-grid.js";
import { cellWidth } from "../src/render/tui/text.js";

const columns: GridColumn[] = [
  { heading: "Outcome", width: 7 },
  { heading: "Cost", width: 7, numeric: true },
];

describe("week table geometry", () => {
  it("draws labelled columns and joined borders", () => {
    expect(gridRule(columns, "top", plainPalette)).toBe("  ╭─────────┬─────────╮");
    expect(gridHeading(columns, plainPalette)).toBe("  │ Outcome │    Cost │");
    expect(gridRule(columns, "bottom", plainPalette)).toBe("  ╰─────────┴─────────╯");
  });

  it("left aligns text and right aligns figures without changing unknowns", () => {
    expect(gridRow(["open", "unknown"], columns, plainPalette))
      .toBe("  │ open    │ unknown │");
    expect(gridRow(["merged", "$1.26"], columns, plainPalette))
      .toBe("  │ merged  │   $1.26 │");
  });

  it("joins spanning intents to the same column boundaries", () => {
    expect(gridRule(columns, "aboveIntent", plainPalette)).toBe("  ├─────────┴─────────┤");
    expect(gridRule(columns, "belowIntent", plainPalette)).toBe("  ├─────────┬─────────┤");
    expect(gridIntent("Build the UI", columns, plainPalette, (text) => text))
      .toEqual(["  │ Build the UI      │"]);
  });

  it("wraps the whole intent without losing literal characters", () => {
    const intent = "Keep all of this declaration and its last word.";
    const lines = gridIntent(intent, columns, plainPalette, (text) => text);
    expect(lines.map((line) => line.slice(4, -2).trimEnd()).join(" ")).toBe(intent);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => cellWidth(line) === 23)).toBe(true);
  });

  it("measures wide and combining characters in terminal cells", () => {
    const row = gridRow(["界e\u0301", "$0.00"], columns, plainPalette);
    expect(cellWidth(row)).toBe(23);
    expect(row).toContain("界e\u0301     │");
    const lines = gridIntent("界".repeat(24), columns, plainPalette, (text) => text);
    expect(lines.every((line) => cellWidth(line) === 23)).toBe(true);
  });

  it("applies ink after measuring and strips record control sequences", () => {
    const blue = (text: string): string => `\u001b[34m${text}\u001b[39m`;
    const palette = { ...plainPalette, meta: blue };
    const plain = gridRow(["open", "unknown"], columns, plainPalette);
    const inked = gridRow(["open", "unknown"], columns, palette, [blue]);
    expect(stripVTControlCharacters(inked)).toBe(plain);
    const intent = gridIntent("\u001b[31mBuild UI\u001b[0m", columns, palette, blue);
    expect(stripVTControlCharacters(intent.join())).toContain("Build UI");
    expect(stripVTControlCharacters(intent.join())).not.toContain("[31m");
  });
});
