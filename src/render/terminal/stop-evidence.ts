import { sessionFigure, wasMeasured } from "../../pricing.js";
import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { breakdown, hasCompleteTokens, NO_RATES, pricesChecked, type View } from "./cost.js";
import { fieldTable, type TableField } from "./field-table.js";
import { startRows } from "./start-rows.js";

export type StopView = Pick<View, "rates" | "checked"> & {
  outcome?: Session["outcome"] | "unknown";
};

/** Share the same measured facts between the terminal table and plain output. */
function evidenceFields(cost: Session["cost"], view: StopView): TableField[] {
  const complete = hasCompleteTokens(cost);
  const figure = complete ? sessionFigure(cost, view.rates ?? NO_RATES) : undefined;
  return [
    { label: "turns", values: [wasMeasured(cost) ? String(cost.turns) : "unknown"] },
    { label: "tokens", values: [complete ? breakdown(cost) : "unknown"] },
    { label: "cost", values: [figure ?? "unknown"] },
    ...(figure !== undefined && view.checked !== undefined
      ? [{ label: "", values: [pricesChecked(view.checked)] }] : []),
  ];
}

/** Evidence stays unknown wherever the record cannot supply the whole figure. */
export function stopEvidenceRows(
  session: Session, palette: Palette, width?: number, view: StopView = {},
): string[] {
  const fields = evidenceFields(session.cost, view).map(field => ({ ...field, ink: palette.meta }));
  return ["", ...(width !== undefined ? fieldTable(fields, palette, width)
    : fields.flatMap(field => field.values.flatMap(value => startRows(field.label, value, palette.meta, palette))))];
}
