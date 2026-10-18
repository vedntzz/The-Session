import { plainPalette, type Palette } from "../palette.js";
import { cellWidth, foldLiteral } from "../tui/text.js";
import { startFrameWidth } from "./start-frame.js";
import { gridHeading, gridRow, gridRule, type GridColumn } from "./table-grid.js";

export interface TableField {
  label: string;
  values: readonly string[];
  ink?: (text: string) => string;
  prefix?: string;
}
type FieldColumns = [GridColumn, GridColumn];

function fieldRows(field: TableField, columns: FieldColumns, palette: Palette): string[] {
  const prefix = field.prefix ?? ""; const size = cellWidth(prefix);
  const values = field.values.flatMap(value => foldLiteral(value, columns[1].width - size)
    .map((part, index) => (index ? " ".repeat(size) : prefix) + part));
  return values.map((value, index) => gridRow([index ? "" : field.label, value], columns,
    palette, [palette.meta, field.ink ?? (text => text)]));
}

/** A shared read-only field table; values wrap before ink and are never shortened. */
export function fieldTable(fields: readonly TableField[], palette: Palette = plainPalette, width?: number): string[] {
  const available = startFrameWidth(width);
  if (available === undefined) return [];
  const label = Math.max(6, ...fields.map(field => cellWidth(field.label)));
  const columns: FieldColumns = [{ heading: "Field", width: label },
    { heading: "Recorded value", width: available - label - 9 }];
  return [gridRule(columns, "top", palette), gridHeading(columns, palette),
    ...fields.flatMap(field => [
      ...(field.label ? [gridRule(columns, "row", palette)] : []),
      ...fieldRows(field, columns, palette),
    ]), gridRule(columns, "bottom", palette)];
}
