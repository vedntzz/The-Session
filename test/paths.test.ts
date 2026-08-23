import { describe, expect, it } from "vitest";
import { describePaths, PATHS_NAMED, summarizePaths } from "../src/render/terminal.js";

/**
 * The one rule both `show` and `stop` name their files by. Tested here rather
 * than twice over in the two views: the point of the shared function is that
 * there is one answer, and a second copy of these assertions would be the
 * drift it exists to prevent.
 */

describe("summarizePaths", () => {
  it("names the paths while there are few enough to read", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];

    expect(summarizePaths(paths)).toEqual({ named: paths, where: "", count: 3 });
  });

  it("stops naming them at more than three", () => {
    const summary = summarizePaths(["a/1.ts", "a/2.ts", "a/3.ts", "b/4.ts"]);

    expect(summary.named).toEqual([]);
    expect(summary.where).toBe("mostly in a/ and b/");
  });

  it("keeps the count exact whether or not it names them", () => {
    // The paths are what gets dropped from a long line. The number of them is
    // the figure being asked for, and it is what decides whether to go and
    // look at the rest.
    expect(summarizePaths(["a.ts"]).count).toBe(1);
    expect(summarizePaths(Array.from({ length: 40 }, (_, i) => `src/${i}.ts`)).count).toBe(40);
  });

  it("names the two commonest directories, not the first two it met", () => {
    const summary = summarizePaths([
      "rare/1.ts",
      "common/1.ts",
      "common/2.ts",
      "common/3.ts",
      "second/1.ts",
      "second/2.ts",
    ]);

    expect(summary.where).toBe("mostly in common/ and second/");
  });

  it("says all in where one directory holds every one of them", () => {
    // "Mostly" would understate a fact the paths have already settled, and
    // this line is the only thing the reader gets.
    expect(summarizePaths(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]).where).toBe(
      "all in src/",
    );
  });

  it("breaks a tie on the directory's name, so a line reads the same twice", () => {
    const summary = summarizePaths(["zebra/1.ts", "apple/1.ts", "middle/1.ts", "apple/2.ts"]);

    expect(summary.where).toBe("mostly in apple/ and middle/");
  });

  it("has a name for a file with no directory in it", () => {
    expect(summarizePaths(["a.ts", "b.ts", "c.ts", "d.ts"]).where).toBe("all in the top level");
  });

  it("names nothing for no paths at all", () => {
    expect(summarizePaths([])).toEqual({ named: [], where: "", count: 0 });
  });

  it("names exactly PATHS_NAMED before it gives up", () => {
    const paths = Array.from({ length: PATHS_NAMED }, (_, i) => `src/${i}.ts`);

    expect(summarizePaths(paths).named).toHaveLength(PATHS_NAMED);
    expect(summarizePaths([...paths, "src/extra.ts"]).named).toEqual([]);
  });
});

describe("describePaths", () => {
  it("joins the paths with whatever the caller separates a line by", () => {
    // A sentence and a column want different ones; the rule that decides
    // between a list and a count is not the caller's business.
    expect(describePaths(["a.ts", "b.ts"], ", ")).toBe("a.ts, b.ts");
    expect(describePaths(["a.ts", "b.ts"], "  ")).toBe("a.ts  b.ts");
  });

  it("gives the count and the directories once the list is too long", () => {
    expect(describePaths(["a/1.ts", "a/2.ts", "a/3.ts", "b/4.ts"], "  ")).toBe(
      "4 files, mostly in a/ and b/",
    );
  });

  it("says nothing at all for no paths", () => {
    expect(describePaths([], "  ")).toBe("");
  });
});
