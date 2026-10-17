// `session stop`.
import type { Command } from "commander";
import { formatStopped, stopSession } from "../commands/stop.js";
import { stopFromHook } from "../commands/agent-session.js";
import { hookPayloadFrom } from "../capture/adapters/hook-payload.js";
import { sweepFirst } from "../commands/sweep.js";
import { loadChecked, loadRates } from "../pricing.js";
import { withOutcomes } from "../observe.js";
import { storeHome, type Session } from "../store.js";
import { paletteFor, type Palette } from "../render/palette.js";
import { formatStopConfirmation } from "../render/terminal/stop.js";
import { START_MIN_WIDTH } from "../render/terminal/start-frame.js";
import { terminalWidth } from "../render/terminal/text.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerStop(program: Command, options: ProgramOptions): void {
  const palette = options.palette ?? paletteFor();
  program
    .command("stop")
    .description("End the active session")
    .option("--if-open", "do nothing when no session is open, instead of failing")
    .action((flags: { ifOpen?: boolean }) => stopAndPrint(flags.ifOpen === true, options, palette));
}

async function stopAndPrint(ifOpen: boolean, options: ProgramOptions, palette: Palette): Promise<void> {
  const session = ifOpen ? await stopFromHook(options, await hookPayloadFrom(options.stdin)) : await stopSession(options);
  if (session) await printStopped(session, options, palette, ifOpen);
  // Confirm the completed record before sweeping. A hook still sweeps when nothing was open.
  printLines((await sweepFirst(options)).notice);
}

async function printStopped(session: Session, options: ProgramOptions, palette: Palette, ifOpen: boolean): Promise<void> {
  const rates = await loadRates(storeHome(options));
  const legacy = formatStopped(session, rates);
  if (ifOpen) return printLines(legacy);
  const outcome = await stoppedOutcome(session, options);
  const checked = await loadChecked();
  printLines(formatStopConfirmation(session, palette, legacy.slice(2), terminalWidth(options.appTerminal?.output, START_MIN_WIDTH), { rates, checked, outcome }));
}

async function stoppedOutcome(session: Session, options: ProgramOptions): Promise<Session["outcome"] | "unknown"> {
  try {
    const [resolved] = await withOutcomes([session], options.cwd ?? process.cwd());
    return resolved!.outcome;
  } catch {
    return "unknown";
  }
}
