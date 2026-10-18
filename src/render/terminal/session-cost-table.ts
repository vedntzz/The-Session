import { agentsOf, callsOf } from "../../agents.js";
import { attributionEntries } from "../../config.js";
import { emptyTurnsOf } from "../../empty.js";
import { priceSession, sessionFigure, wasMeasured } from "../../pricing.js";
import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { breakdown, costCell, hasCompleteTokens, NO_RATES, NOT_MEASURED, pricesChecked, wasteCell, type View } from "./cost.js";
import { fieldTable, type TableField } from "./field-table.js";
import { captureDescription } from "./session-cost.js";
import { figure, shortId } from "./text.js";
import { turnModelFacts } from "./turn-models.js";

function field(label: string, value: string | string[]): TableField {
  return { label, values: typeof value === "string" ? [value] : value };
}

function usageFields(session: Session, view: View): TableField[] {
  const measured = wasMeasured(session.cost);
  const calls = measured ? callsOf(session.cost, view.agents ?? []) : undefined;
  const empty = measured ? emptyTurnsOf(session) : undefined;
  const agents = agentsOf(session.cost, view.agents ?? []);
  return [
    field("id", shortId(session.id)), field("turns", measured ? figure(session.cost.turns) : "unknown"),
    field("calls", calls === undefined ? "unknown" : figure(calls)),
    field("empty turns", empty === undefined ? "unknown" : figure(empty)),
    field("agents", agents.length ? agents : ["unknown"]),
    field("captured", measured ? captureDescription(session.cost) : "unknown"),
  ];
}

function modelFields(session: Session): TableField[] {
  const { models, imports } = turnModelFacts(session);
  const named = Object.keys(session.cost.modelTokens ?? {}).sort();
  const turns = new Set(session.cost.turnModels ?? []);
  const values = models === undefined ? named.length ? named : [session.cost.model || "unknown"]
    : [models, ...named.filter(name => !turns.has(name))];
  return [field("models", values), ...(imports ? [field("imported", imports)] : [])];
}

function emptyCostField(session: Session, palette: Palette, view: View): TableField {
  const waste = hasCompleteTokens(session.cost) ? wasteCell(session, priceSession(session.cost, view.rates ?? NO_RATES)) : undefined;
  const value = waste === undefined || waste.text === NOT_MEASURED ? "unknown" : waste.text;
  return { ...field("no edits", value), ink: waste?.spent ? palette.waste : palette.meta };
}

function moneyFields(session: Session, view: View): TableField[] {
  const complete = hasCompleteTokens(session.cost);
  const total = complete ? sessionFigure(session.cost, view.rates ?? NO_RATES) : undefined;
  const reason = total === undefined && wasMeasured(session.cost) && view.rates !== undefined
    ? complete ? costCell(session.cost, priceSession(session.cost, view.rates)) : "incomplete token capture" : undefined;
  return [field("cost", total ?? "unknown"), ...(reason ? [field("", reason)] : []),
    ...(total !== undefined && view.tokens && view.checked !== undefined ? [field("", pricesChecked(view.checked))] : [])];
}

/** The shared cost remains one figure, after usage and recorded attribution. */
export function detailCostTable(session: Session, palette: Palette, width: number, view: View): string[] {
  const fields = [
    ...usageFields(session, view), ...modelFields(session),
    ...(view.tokens ? [field("tokens", hasCompleteTokens(session.cost) ? breakdown(session.cost) : "unknown")] : []),
    emptyCostField(session, palette, view),
    ...attributionEntries(session.attribution).map(([key, value]) => field(key, value)),
    ...moneyFields(session, view),
  ];
  return fieldTable(fields.map(item => ({ ...item, ink: item.ink ?? palette.meta })), palette, width);
}
