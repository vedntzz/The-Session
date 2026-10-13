import { stripVTControlCharacters } from "node:util";
import { plainPalette, type Palette } from "../palette.js";
import { cellWidth } from "../tui/text.js";
import { INDENT, MIN_WIDTH } from "./text.js";

function frameBorder(left: string, right: string, width: number, palette: Palette): string {
  return INDENT + palette.meta(left + "─".repeat(width - INDENT.length - 2) + right);
}

/** Callers supply safe, rendered lines; ANSI styling never counts as padding. */
function frameLine(line: string, width: number, palette: Palette): string {
  const content = line.startsWith(INDENT) ? line.slice(INDENT.length) : line;
  const padding = " ".repeat(Math.max(0, width - 6 - cellWidth(stripVTControlCharacters(content))));
  return INDENT + palette.meta("│ ") + content + padding + palette.meta(" │");
}

/** Draw a terminal frame while leaving unknown-width output undecorated. */
export function startFrame(lines: readonly string[], palette: Palette = plainPalette, width?: number): string[] {
  if (width === undefined || !Number.isFinite(width)) return [...lines];
  const columns = Math.max(MIN_WIDTH, Math.min(80, Math.trunc(width)));
  return [
    frameBorder("╭", "╮", columns, palette),
    ...lines.map(line => frameLine(line, columns, palette)),
    frameBorder("╰", "╯", columns, palette),
  ];
}
