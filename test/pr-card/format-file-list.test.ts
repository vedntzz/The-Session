// The card's file lines: a count, what went outside scope first, then the rest.
import { describe, expect, it } from "vitest";
import { formatFileList } from "../../src/pr-card/format-file-list.js";

const EMOJI = /\p{Extended_Pictographic}/u;
const inside = (path: string) => ({ path, inScope: true });
const outside = (path: string) => ({ path, inScope: false });
const many = (count: number, make: (path: string) => { path: string; inScope: boolean }, prefix: string) =>
  Array.from({ length: count }, (_, i) => make(`${prefix}${i}.ts`));

describe("formatFileList", () => {
  it("lists in-scope files plain under a count", () => {
    expect(formatFileList([inside("a.ts"), inside("b.ts")])).toEqual(["2 files", "a.ts", "b.ts"]);
  });

  it("flags out-of-scope files and lists them first", () => {
    expect(formatFileList([inside("a.ts"), outside("x.ts")])).toEqual([
      "2 files · 1 outside scope",
      "x.ts (outside agreed scope)",
      "a.ts",
    ]);
  });

  it("says when nothing changed", () => {
    expect(formatFileList([])).toEqual(["no files changed"]);
  });

  it("counts the whole list in the header", () => {
    const files = [...many(4, inside, "in"), ...many(2, outside, "out")];
    expect(formatFileList(files)[0]).toBe("6 files · 2 outside scope");
  });

  it("shows the first ten and says how many more", () => {
    const lines = formatFileList(many(13, inside, "in"));
    expect(lines.slice(1, -1)).toHaveLength(10);
    expect(lines.at(-1)).toBe("+3 more");
  });

  it("always shows every out-of-scope file, even past ten", () => {
    const lines = formatFileList([...many(5, inside, "in"), ...many(12, outside, "out")]);
    expect(lines.filter((line) => line.endsWith("(outside agreed scope)"))).toHaveLength(12);
    expect(lines.at(-1)).toBe("+5 more");
  });

  it("fills the rest of the ten with in-scope files", () => {
    const lines = formatFileList([...many(15, inside, "in"), ...many(3, outside, "out")]);
    expect(lines.slice(1, -1)).toHaveLength(10);
    expect(lines.at(-1)).toBe("+8 more");
  });

  it("uses no emoji", () => {
    const lines = formatFileList([...many(12, inside, "in"), ...many(2, outside, "out")]);
    expect(lines.filter((line) => EMOJI.test(line))).toEqual([]);
  });
});
