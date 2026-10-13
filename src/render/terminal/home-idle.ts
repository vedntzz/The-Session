import { sessionFigure } from "../../pricing.js";
import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { hasCompleteTokens, NO_RATES, type View } from "./cost.js";
import { sessionIntentRows } from "./home-recording.js";
import { startRows } from "./start-rows.js";
import { clock, INDENT, shortId } from "./text.js";

/** An idle checkout either has a last record or is ready for its first one. */
export function formatIdleHome(last: Session | undefined, palette: Palette = plainPalette, view: View = {}): string[] {
  return last ? stoppedHome(last, palette, view) : readyHome(palette, view.width);
}

function readyHome(palette: Palette, width?: number): string[] {
  const row = (name: string, value: string): string[] => startRows(name, value, palette.meta, palette, width);
  return [
    `${INDENT}${palette.meta("◔ session  ready")}`,
    "",
    ...row("state", "No sessions recorded in this repo yet."),
    "",
    ...row("next", "session start"),
    ...row("", "session hook install"),
  ];
}

function stoppedHome(last: Session, palette: Palette, view: View): string[] {
  const row = (name: string, value: string): string[] => startRows(name, value, palette.meta, palette, view.width);
  const price = hasCompleteTokens(last.cost) ? sessionFigure(last.cost, view.rates ?? NO_RATES) : undefined;
  return [
    `${INDENT}${palette.meta("◔ session  stopped")}`,
    "",
    ...row("state", "Nothing is recording."),
    ...sessionIntentRows(last, palette, view.width),
    ...row("last", shortId(last.id)),
    ...row("ended", last.endedAt === null ? "unknown" : clock(last.endedAt)),
    ...row("cost", price ?? "unknown"),
    "",
    ...row("next", "session week last"),
    ...row("", "session start"),
  ];
}
