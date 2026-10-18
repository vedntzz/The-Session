import { knownAgents } from "../capture/index.js";
import { showSession } from "../commands/show.js";
import { sweepFirst } from "../commands/sweep.js";
import { loadChecked, loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatBrief, formatSession, MIN_WIDTH, terminalWidth } from "../render/terminal.js";
import { START_MIN_WIDTH } from "../render/terminal/start-frame.js";
import type { View } from "../render/terminal/cost.js";
import { storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";
import type { WeekFlags } from "./week.js";

/** `last` selects the most recent closed session through the existing resolver. */
export const LAST = "last";

async function sessionView(flags: WeekFlags, options: ProgramOptions, full: boolean): Promise<View> {
  return {
    rates: await loadRates(storeHome(options)),
    ...(flags.tokens === true ? { checked: await loadChecked() } : {}),
    tokens: flags.tokens, agents: knownAgents(),
    width: terminalWidth(options.appTerminal?.output, full ? START_MIN_WIDTH : MIN_WIDTH),
  };
}

/** Resolve once, then render against the actual destination's terminal width. */
export async function emitSession(id: string, flags: WeekFlags, options: ProgramOptions, palette: Palette): Promise<void> {
  const full = flags.full === true || flags.tokens === true;
  const { notice, facts } = await sweepFirst(options);
  const session = await showSession(id === LAST ? undefined : id, options, facts);
  const view = await sessionView(flags, options, full);
  const render = full ? formatSession : formatBrief;
  printLines([...notice, ...render(session, palette, view)]);
}
