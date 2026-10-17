// The card's file lines: a count, then what went outside scope, then the rest. Pure.
import { plural } from "../render/terminal/text.js";
import type { CardFile } from "./card-data.js";

/** How many files the card lists before folding the rest into a count. */
export const SHOWN_FILES = 10;

/** One line per entry; every out-of-scope file is shown, whatever the limit. */
export function formatFileList(files: readonly CardFile[]): string[] {
  if (files.length === 0) {
    return ["no files changed"];
  }
  const outside = files.filter((file) => !file.inScope);
  const inside = files.filter((file) => file.inScope).slice(0, Math.max(0, SHOWN_FILES - outside.length));
  const hidden = files.length - outside.length - inside.length;
  const lines = [header(files.length, outside.length), ...outside.map(flagged), ...inside.map((file) => file.path)];
  return hidden > 0 ? [...lines, `+${hidden} more`] : lines;
}

/** "6 files · 2 outside scope", without the second part when nothing went outside. */
function header(total: number, outside: number): string {
  const count = plural(total, "file", "files");
  return outside > 0 ? `${count} · ${outside} outside scope` : count;
}

/** An out-of-scope file, marked so it reads as one without colour. */
function flagged(file: CardFile): string {
  return `⚠ ${file.path} (outside agreed scope)`;
}
