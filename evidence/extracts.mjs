// The verbatim blocks docs/context.md copies out of the files that own them.
//
// One implementation, imported by both the generator that writes the document
// and the test that checks it has not drifted. Two copies of these rules would
// be two answers to "is context.md stale", and the one that disagreed would be
// whichever was not looked at.
import { readFileSync } from "node:fs";
import path from "node:path";

/** Everything between two headings, exclusive of both. */
function between(text, start, end, what) {
  const from = text.indexOf(start);
  if (from === -1) {
    throw new Error(`${what}: could not find ${JSON.stringify(start)}`);
  }
  const rest = text.slice(from + start.length);
  const to = rest.indexOf(end);
  if (to === -1) {
    throw new Error(`${what}: could not find ${JSON.stringify(end)} after it`);
  }
  return rest.slice(0, to).trim();
}

const read = (root, file) => readFileSync(path.join(root, file), "utf8");

/**
 * A whole top-level declaration, brace-matched from column zero.
 *
 * By name rather than by line number: a range like `lines[167:251]` silently
 * follows whatever moved into it the next time somebody inserts a field above,
 * and this file exists to notice exactly that kind of drift.
 */
function declaration(text, signature, what) {
  const from = text.indexOf(signature);
  if (from === -1) {
    throw new Error(`${what}: could not find ${JSON.stringify(signature)}`);
  }
  const end = text.indexOf("\n}", from);
  if (end === -1) {
    throw new Error(`${what}: ${JSON.stringify(signature)} is never closed at column zero`);
  }
  return text.slice(from, end + 2);
}

/** The five invariants, from the file that owns them. */
export const invariants = (root) =>
  between(read(root, "Claude.md"), "## Invariants — do not violate these\n", "\n## Stack", "invariants");

/** The source layout block, same file. */
export const layout = (root) =>
  between(read(root, "Claude.md"), "## Layout\n", "\n## The record", "layout");

/** `interface Session` — the record itself. */
export const sessionInterface = (root) =>
  declaration(read(root, "src/store/record.ts"), "export interface Session {", "interface Session");

/** The surface freeze. */
export const whatOneZeroMeans = (root) =>
  between(read(root, "docs/decisions.md"), "## What 1.0 means\n", "\n## Rejected", "what 1.0 means");

/**
 * The measurement rules, with the two transforms `context.md` documents:
 * headings demoted one level so they nest under its own, and the skill's
 * relative links repointed at `docs/`, where the copy lives.
 */
export function measurementRules(root) {
  const file = ".claude/skills/measurement-rules/SKILL.md";
  const parts = read(root, file).split("---\n");
  if (parts.length < 3) {
    throw new Error(`measurement rules: ${file} has no frontmatter to skip`);
  }
  const lines = parts.slice(2).join("---\n").trim().split("\n");
  if (lines[0] !== "# Measurement rules") {
    throw new Error(`measurement rules: expected a leading H1, found ${JSON.stringify(lines[0])}`);
  }
  return lines
    .slice(1) // its H1; context.md's own heading covers it
    .map((line) => (line.startsWith("#") ? `#${line}` : line))
    .map((line) => line.replaceAll("../../../docs/decisions.md", "decisions.md"))
    .join("\n")
    .trim();
}

/** Every block, by the name the template and the test both use. */
export const extracts = {
  invariants,
  layout,
  sessionInterface,
  whatOneZeroMeans,
  measurementRules,
};
