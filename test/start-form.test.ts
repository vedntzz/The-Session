import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatStartForm } from "../src/render/terminal/start-form.js";
import { cellWidth } from "../src/render/tui/text.js";

it("labels the fields and the next action before anything is recorded", () => {
  const lines = formatStartForm({}, plainPalette, 80);
  expect(lines.some(line => /^  ╭─+┬─+╮$/u.test(line))).toBe(true);
  expect(lines.find(line => line.includes("Your declaration"))).toContain("Field");
  expect(lines.find(line => line.includes("Intent"))).toContain("Enter below");
  expect(lines.find(line => line.includes("Scope"))).toContain("Optional; add next");
  expect(lines.join("\n")).not.toContain("RECORDING");
});

it.each([40, 60, 80, 120])("keeps the full declaration and column edges at %i columns", width => {
  const intent = "Keep 界e\u0301 " + "all these words ".repeat(12) + "literal.";
  const lines = formatStartForm({ intent }, plainPalette, width);
  const cells = lines.filter(line => line.startsWith("  │ ")).map(line => line.split("│")[2]?.trim());
  expect(cells.slice(1, -1).join(" ")).toBe(intent);
  expect(new Set(lines.map(cellWidth))).toEqual(new Set([Math.min(80, width)]));
  expect(lines.find(line => line.includes("Scope"))).toContain("Enter paths below");
});

it("shows every provided scope path without interpreting or shortening it", () => {
  const paths = ["src/a  file.ts", "notes/a,b*[draft].md", "資料/cafe\u0301.ts"];
  const lines = formatStartForm({ scope: paths }, plainPalette, 80);
  for (const path of paths) expect(lines.some(line => line.includes(path))).toBe(true);
  expect(lines.join("\n")).not.toContain("Optional; add next");
});

it("wraps literal paths so joining their parts restores every character", () => {
  const path = "src/" + "a file with spaces/".repeat(5) + "panel.ts";
  const lines = formatStartForm({ intent: "Build", scope: [path] }, plainPalette, 40);
  const cells = lines.filter(line => line.startsWith("  │ ")).map(line => line.split("│")[2]?.slice(1, -1));
  expect(cells.slice(2).join("").replace(/\s/gu, ""))
    .toBe(path.replace(/\s/gu, ""));
});

it("uses the same geometry with and without colour", () => {
  const values = { intent: "Build a form", scope: ["src/"] };
  expect(formatStartForm(values, ansiPalette, 40).map(stripVTControlCharacters))
    .toEqual(formatStartForm(values, plainPalette, 40));
});

it("strips control sequences without modifying the declaration", () => {
  const values = { intent: "Build\u001b[2J UI", scope: ["src/\u001b[31mfile.ts"] };
  const before = structuredClone(values);
  const text = formatStartForm(values, plainPalette, 80).join("\n");
  expect(text).toContain("Build UI"); expect(text).toContain("src/file.ts");
  expect(text).not.toContain("\u001b"); expect(values).toEqual(before);
});

it("does not add decoration when a width was never supplied", () => {
  expect(formatStartForm({}, plainPalette)).toEqual([]);
});
