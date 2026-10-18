import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { outcomeInk } from "./cost.js";
import { fieldTable } from "./field-table.js";
import { sessionIntentFields, sessionIntentRows } from "./home-recording.js";
import { startRows } from "./start-rows.js";

/** Use the same resolved outcome and declaration in terminal and plain output. */
export function stopDeclarationRows(
  session: Session, palette: Palette, width?: number,
  outcome: Session["outcome"] | "unknown" = session.outcome,
): string[] {
  const ink = outcome === "unknown" ? palette.meta : outcomeInk(palette, outcome);
  if (width === undefined) return [
    ...startRows("outcome", outcome, ink, palette), ...sessionIntentRows(session, palette),
  ];
  return fieldTable([
    { label: "outcome", values: [outcome], ink }, ...sessionIntentFields(session, palette),
  ], palette, width);
}
