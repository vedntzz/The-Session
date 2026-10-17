import { reportedOutcome } from "../../../outcome.js";
import type { Session } from "../../../store.js";
import type { Palette } from "../../palette.js";
import { cellWidth } from "../../tui/text.js";
import { outcomeInk } from "../cost.js";
import { gridHeading, gridIntent, gridRow, gridRule, type GridColumn } from "./grid.js";
import { figureRow, headingRow, intentLines, intentText, type Columns, type WeekCells, type Widths } from "./table.js";

export interface WeekLayout {
  cells: ReadonlyMap<Session, WeekCells>;
  widths: Widths;
  show: Columns;
  palette: Palette;
  limit: number | undefined;
}

interface WeekColumn extends GridColumn { key: keyof WeekCells }
const COLUMNS: readonly [keyof WeekCells, string, boolean?][] = [
  ["id", "ID"], ["when", "Started"], ["class", "Class"], ["outcome", "Outcome"],
  ["outside", "Outside", true], ["turns", "Turns", true], ["tokens", "Tokens", true],
  ["edits", "No edits", true], ["cost", "Cost", true],
];

function columnsFor(layout: WeekLayout): WeekColumn[] {
  return COLUMNS.filter(([key]) =>
    (key !== "class" || layout.show.classes) && (key !== "tokens" || layout.show.tokens))
    .map(([key, heading, numeric]) => ({
      key, heading, numeric: numeric === true,
      width: Math.max(layout.widths[key], cellWidth(heading)),
    }));
}

/** A terminal gets a visible grid; a pipe keeps its stable plain layout. */
export function weekRows(sessions: readonly Session[], layout: WeekLayout): string[] {
  const { palette } = layout;
  if (layout.limit === undefined) {
    return [palette.meta(headingRow(layout.widths, layout.show)),
      ...sessions.flatMap((session) => plainSession(session, layout))];
  }
  const columns = columnsFor(layout);
  return [gridRule(columns, "top", palette), gridHeading(columns, palette),
    ...sessions.flatMap((session) => [gridRule(columns, "aboveIntent", palette),
      ...borderedSession(session, columns, layout)]),
    gridRule(columns, "bottom", palette)];
}

function borderedSession(session: Session, columns: WeekColumn[], layout: WeekLayout): string[] {
  const { palette } = layout;
  const cells = layout.cells.get(session) as WeekCells;
  const outcome = reportedOutcome(session);
  const abandoned = outcome === "abandoned";
  const inks = columns.map(({ key }) => abandoned ? palette.abandoned :
    key === "outcome" ? outcomeInk(palette, outcome) : (text: string) => text);
  return [
    ...gridIntent(intentText(session), columns, palette, abandoned ? palette.abandoned : palette.intent),
    gridRule(columns, "belowIntent", palette),
    gridRow(columns.map(({ key }) => cells[key]), columns, palette, inks),
  ];
}

/** The existing two-line layout remains byte-for-byte stable for pipes. */
function plainSession(session: Session, layout: WeekLayout): string[] {
  const { palette, widths, show } = layout;
  const cells = layout.cells.get(session) as WeekCells;
  const intent = intentLines(session, layout.limit);
  const outcome = reportedOutcome(session);
  if (outcome === "abandoned") {
    return [...intent, figureRow(cells, widths, show)].map((line) => palette.abandoned(line));
  }
  const ink = { outcome: outcomeInk(palette, outcome) };
  return [...intent.map((line) => palette.intent(line)), figureRow(cells, widths, show, ink)];
}
