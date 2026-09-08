// `docs/context.md` copies five blocks verbatim out of the files that own
// them. This is what notices when one of those files moves on and the copy
// does not.
//
// It asserts presence, not equality: the document wraps each block in prose of
// its own, and what matters is that the copied bytes are still the source's
// bytes. The fix for a failure here is never to edit `docs/context.md` — run
// `node evidence/gen-context.mjs` and commit what it writes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as extracts from "../evidence/extracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT = path.join(ROOT, "docs/context.md");
const REGENERATE = "run `node evidence/gen-context.mjs` and commit the result";

const document = (): string => readFileSync(CONTEXT, "utf8");

/** Each block, and the file it is copied from, for the failure message. */
const BLOCKS: ReadonlyArray<{ what: string; source: string; extract: (root: string) => string }> = [
  { what: "the five invariants", source: "Claude.md", extract: extracts.invariants },
  { what: "the layout", source: "Claude.md", extract: extracts.layout },
  {
    what: "interface Session",
    source: "src/store/record.ts",
    extract: extracts.sessionInterface,
  },
  {
    what: "what 1.0 means",
    source: "docs/decisions.md",
    extract: extracts.whatOneZeroMeans,
  },
  {
    what: "the measurement rules",
    source: ".claude/skills/measurement-rules/SKILL.md",
    extract: extracts.measurementRules,
  },
];

describe("docs/context.md", () => {
  it.each(BLOCKS)("carries $what verbatim from $source", ({ what, source, extract }) => {
    const expected = extract(ROOT);
    expect(expected.length, `${what}: extracted nothing from ${source}`).toBeGreaterThan(0);

    if (!document().includes(expected)) {
      // The whole block is too long to read in a diff, so say which line first
      // parted company with the source. That is the edit somebody made.
      const text = document();
      const drifted = expected
        .split("\n")
        .find((line) => line.trim().length > 0 && !text.includes(line));
      throw new Error(
        `docs/context.md no longer matches ${source} for ${what}.\n` +
          (drifted === undefined
            ? "Every line is present, so the block has been reordered or broken up.\n"
            : `First line not found:\n  ${drifted}\n`) +
          `To fix: ${REGENERATE}.`,
      );
    }
  });

  it("says where each copied block came from", () => {
    const text = document();
    for (const { source } of BLOCKS) {
      expect(text, `context.md never names ${source} as a source`).toContain(source);
    }
  });

  it("names the generator, so a reader fixes it the right way", () => {
    expect(document()).toContain("evidence/gen-context.mjs");
  });
});
