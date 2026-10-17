import type { Palette } from "../../palette.js";
import { cellWidth, foldLiteral, safeText } from "../../tui/text.js";
import { INDENT } from "../text.js";

type Ink = (text: string) => string;
export interface GridColumn {
  heading: string;
  width: number;
  numeric?: boolean;
}

const JOINS = {
  top: ["╭", "┬", "╮"],
  bottom: ["╰", "┴", "╯"],
  aboveIntent: ["├", "┴", "┤"],
  belowIntent: ["├", "┬", "┤"],
} as const;

/** Borders share exactly the same cell widths as the figures beneath them. */
export function gridRule(
  columns: readonly GridColumn[],
  kind: keyof typeof JOINS,
  palette: Palette,
): string {
  const [left, join, right] = JOINS[kind];
  const line = columns.map((column) => "─".repeat(column.width + 2)).join(join);
  return INDENT + palette.meta(left + line + right);
}

function padded(text: string, column: GridColumn): string {
  const clean = safeText(text);
  const spaces = " ".repeat(Math.max(0, column.width - cellWidth(clean)));
  return column.numeric ? spaces + clean : clean + spaces;
}

export function gridRow(
  values: readonly string[],
  columns: readonly GridColumn[],
  palette: Palette,
  inks: readonly Ink[] = [],
): string {
  const cells = columns.map((column, index) => {
    const value = padded(values[index] ?? "", column);
    return inks[index]?.(value) ?? value;
  });
  return INDENT + palette.meta("│ ") + cells.join(palette.meta(" │ ")) + palette.meta(" │");
}

export function gridHeading(columns: readonly GridColumn[], palette: Palette): string {
  return gridRow(columns.map((column) => column.heading), columns, palette,
    columns.map(() => palette.meta));
}

/** An intent spans all columns and keeps every character of the declaration. */
export function gridIntent(
  text: string,
  columns: readonly GridColumn[],
  palette: Palette,
  ink: Ink,
): string[] {
  const width = columns.reduce((sum, column) => sum + column.width + 3, 0) - 3;
  return foldLiteral(text, width).map((line) =>
    INDENT + palette.meta("│ ") + ink(padded(line, { heading: "", width })) + palette.meta(" │"));
}
