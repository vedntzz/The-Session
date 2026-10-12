import { sessionFigure, wasMeasured } from "../../pricing.js";
import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { breakdown, NO_RATES, pricesChecked, type View } from "./cost.js";
import { startRows } from "./start-rows.js";

export type StopView = Pick<View, "rates" | "checked"> & {
  outcome?: Session["outcome"] | "unknown";
};

/** Evidence stays unknown wherever the record cannot supply the whole figure. */
export function stopEvidenceRows(
  session: Session, palette: Palette, width?: number, view: StopView = {},
): string[] {
  const { cost } = session;
  const measured = wasMeasured(cost);
  const complete = measured && (cost.untokenedTurns ?? 0) === 0 && !cost.turnTokens?.some(turn => turn === null);
  const tokens = complete ? breakdown(cost) : "unknown";
  const figure = complete ? sessionFigure(cost, view.rates ?? NO_RATES) : undefined;
  return [
    "",
    ...startRows("turns", measured ? String(cost.turns) : "unknown", palette.meta, palette, width),
    ...startRows("tokens", tokens, palette.meta, palette, width),
    ...startRows("cost", figure ?? "unknown", palette.meta, palette, width),
    ...(figure !== undefined && view.checked !== undefined
      ? startRows("", pricesChecked(view.checked), palette.meta, palette, width) : []),
  ];
}
