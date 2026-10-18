import { intentSourceOf, type Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { outcomeInk } from "./cost.js";
import { fieldTable, type TableField } from "./field-table.js";
import { sessionIntentFields } from "./home-recording.js";
import { INTENT_NOTE } from "./intent.js";
import { clock, flatten } from "./text.js";

/** Keep shared labels and missing-data reasons, but show every word in the full view. */
function fullIntentFields(session: Session, palette: Palette): TableField[] {
  return sessionIntentFields(session, palette).map((field, index) =>
    index === 0 && session.intent !== null ? { ...field, values: [flatten(session.intent)] } : field);
}

/** Outcome precedes the full declaration; both times come directly from the record. */
export function detailDeclarationTable(session: Session, palette: Palette, width: number): string[] {
  const source = INTENT_NOTE[intentSourceOf(session)];
  const ended = session.endedAt === null ? "still running" : clock(session.endedAt);
  return fieldTable([
    { label: "outcome", values: [session.outcome], ink: outcomeInk(palette, session.outcome) },
    ...fullIntentFields(session, palette),
    ...(source ? [{ label: "source", values: [source], ink: palette.meta }] : []),
    { label: "time", values: [`${clock(session.startedAt)} → ${ended}`], ink: palette.meta },
  ], palette, width);
}
