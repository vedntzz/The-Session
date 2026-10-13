import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, paletteFor, plainPalette, type Palette } from "../src/render/palette.js";
import { formatStartConfirmation } from "../src/render/terminal/start.js";

const session = {
  intent: "Build the UI", scope: ["src/a file.ts", "notes/a,b.md"],
  id: "abcdef01-2345-6789-abcd-0123456789ab", startCommit: "123456789abcdef",
};

it("prints the exact recording confirmation and one next action", () => {
  expect(formatStartConfirmation(session)).toEqual([
    "  ◔ session  RECORDING", "",
    "  intent      Build the UI", "  scope       src/a file.ts",
    "              notes/a,b.md", "  id          abcdef01", "  head        1234567", "",
    "  next        Work in your editor, then run session stop.",
  ]);
});

it("names an empty scope and unknown intent without inventing a value", () => {
  const lines = formatStartConfirmation({ ...session, intent: null, scope: [] });
  expect(lines).toContain("  intent      unknown");
  expect(lines).toContain("  scope       none declared");
  expect(lines.filter((line) => line.includes("session stop"))).toHaveLength(1);
});

it("preserves a full long intent and literal Unicode, brackets, commas and stars", () => {
  const intent = "Build this carefully. ".repeat(50) + "終わり";
  const scope = ["資料/[draft]*, a.ts"];
  const lines = formatStartConfirmation({ ...session, intent, scope });
  expect(lines).toContain(`  intent      ${intent}`);
  expect(lines).toContain("  scope       資料/[draft]*, a.ts");
});

it("keeps existing metadata details between the commit and next action", () => {
  const details = ["  primed   scope reviewed with Prime", "  agreement  saved; policy ask"];
  const lines = formatStartConfirmation(session, plainPalette, details);
  const head = lines.indexOf("  head        1234567");
  expect(lines.slice(head + 1, head + 3)).toEqual(details);
  expect(lines.slice(head + 3)).toEqual(["", "  next        Work in your editor, then run session stop."]);
});

it("neutralizes terminal controls in values and details before applying ink", () => {
  const received: string[] = [];
  const ink = (text: string) => { received.push(text); return text; };
  const palette: Palette = { ...plainPalette, intent: ink, path: ink, meta: ink };
  const lines = formatStartConfirmation({ ...session, intent: "a\u001b[2Jb\nc\u202ed", scope: ["x\u001b[31my\nz\u202e"] },
    palette, ["  owner      A\u001b[?25l\nB\u202e"]);
  expect(lines).toContain("  intent      ab c d");
  expect(lines).toContain("  scope       xy z ");
  expect(lines).toContain("  owner      A B ");
  expect([...received, ...lines].join("")).not.toMatch(/[\u001b\n\r\u202a-\u202e\u2066-\u2069]/u);
});

it("uses basic ANSI recording ink while preserving every plain output byte", () => {
  const plain = formatStartConfirmation(session, plainPalette, ["  owner      Test"]);
  const colored = formatStartConfirmation(session, ansiPalette, ["  owner      Test"]);
  expect(colored.map(stripVTControlCharacters)).toEqual(plain);
  expect(colored[0]).toContain("\u001b[36m");
  const withoutInk = colored.join("\n").replace(/\u001b\[(?:0|1|2|22|3[0-7]|39|9[0-7])m/gu, "");
  expect(withoutInk).not.toContain("\u001b");
});

it("honors NO_COLOR for the recording role on a terminal", () => {
  const palette = paletteFor({ env: { NO_COLOR: "1" }, isTTY: true });
  expect(formatStartConfirmation(session, palette)).toEqual(formatStartConfirmation(session, plainPalette));
});
