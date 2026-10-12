import { expect, it } from "vitest";
import { cellWidth, fold, safeText } from "../src/render/tui/text.js";

it.each([
  ["hello\u001b[2J\u001b]0;bad title\u0007\rworld", "hello world"],
  ["a\u001b[31mb\u001b[0mc", "abc"], ["a\u001b]8;;https://example.com\u001b\\b\u001b]8;;\u001b\\c", "abc"],
  ["a\u0000b\u0007c\u007fd\u0085e", "a b c d e"],
  ["a\u202eb\u2066c\u2069d", "a b c d"], ["a\nb\tc", "a b c"],
])("treats record text %j as data rather than terminal instructions", (input, expected) => {
  expect(safeText(input)).toBe(expected);
});
it.each([["café", 4], ["e\u0301", 1], ["修复", 4], ["👩‍💻", 2], ["a👩‍💻界e\u0301", 6]] as const)("measures graphemes in %s as %i cells", (text, width) => {
  expect(cellWidth(text)).toBe(width);
});
it("folds narrow prose at spaces without truncating words", () => {
  const text = "Keep all declared words reachable"; const lines = fold(text, 10);
  expect(lines.join(" ")).toBe(text); expect(lines.every((line) => cellWidth(line) <= 10)).toBe(true);
});
it("hard-wraps a literal Unicode filename without splitting graphemes", () => {
  const text = `資料/${"e\u0301界👩‍💻".repeat(8)}*[x],.ts`; const lines = fold(text, 7);
  expect(lines.join("")).toBe(text); expect(lines.every((line) => cellWidth(line) <= 7)).toBe(true);
  expect(lines.some((line) => /^\p{Mark}/u.test(line) || /^\u200d|\u200d$/u.test(line))).toBe(false);
});
