// `session help all`: every command, read off the tree.
import { plainPalette, type Palette } from "../palette.js";
import { INDENT, padRight, width } from "./text.js";

// --- the command list ----------------------------------------------------

/** One row of `session help all`. Subcommands carry their parent in the name. */
export interface CommandEntry {
  name: string;
  description: string;
}

/**
 * Every command, for `session help all`.
 *
 * The bare `--help` lists three, which is a decision about what a first reader
 * needs rather than a claim about what exists. This is where the claim is
 * kept, and it is built from the command tree itself rather than from a list
 * beside it — a list beside it would be one release away from being wrong.
 */
export function formatCommands(
  entries: readonly CommandEntry[],
  palette: Palette = plainPalette,
): string[] {
  const widest = entries.reduce((soFar, entry) => Math.max(soFar, width(entry.name)), 0);

  const lines = ["", `${INDENT}Every command. The short list is session --help.`, ""];
  for (const entry of entries) {
    lines.push(`${INDENT}${padRight(entry.name, widest + 2)}${palette.meta(entry.description)}`);
  }
  return lines;
}
