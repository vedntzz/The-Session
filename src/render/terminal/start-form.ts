import { plainPalette, type Palette } from "../palette.js";
import { foldLiteral } from "../tui/text.js";
import { startFrameWidth } from "./start-frame.js";
import { gridHeading, gridRow, gridRule, type GridColumn } from "./table-grid.js";

export interface StartForm {
  intent?: string;
  scope?: readonly string[];
}
type FormColumns = [GridColumn, GridColumn];

function formField(
  name: string, values: readonly string[], columns: FormColumns, palette: Palette,
  ink: (text: string) => string,
): string[] {
  const parts = values.flatMap(value => foldLiteral(value, columns[1].width));
  return parts.map((part, index) =>
    gridRow([index === 0 ? name : "", part], columns, palette, [palette.meta, ink]));
}

function scopeValues(form: StartForm): readonly string[] {
  if (form.scope !== undefined) return form.scope.length ? form.scope : ["none declared"];
  return [form.intent === undefined ? "Optional; add next" : "Enter paths below"];
}

/** The draft stays on screen before recording; only supplied fields are filled. */
export function formatStartForm(form: StartForm, palette: Palette = plainPalette, width?: number): string[] {
  const columns = startFrameWidth(width);
  if (columns === undefined) return [];
  const fields: FormColumns = [{ heading: "Field", width: 6 }, { heading: "Your declaration", width: columns - 15 }];
  return [
    gridRule(fields, "top", palette), gridHeading(fields, palette), gridRule(fields, "row", palette),
    ...formField("Intent", [form.intent ?? "Enter below"], fields, palette, palette.intent),
    gridRule(fields, "row", palette),
    ...formField("Scope", scopeValues(form), fields, palette, text => text),
    gridRule(fields, "bottom", palette),
  ];
}
