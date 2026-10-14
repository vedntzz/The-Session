// `session start`.
import type { Command } from "commander";
import { formatClosedCaptured, formatStarted, startSession } from "../commands/start.js";
import { startFromHook } from "../commands/agent-session.js";
import { hookPayloadFrom } from "../capture/adapters/hook-payload.js";
import type { Session } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";
import { startReviewed } from "../commands/review.js";
import { readStartPrompt } from "../commands/start-prompt.js";
import { plainPalette, type Palette } from "../render/palette.js";
import { formatStartConfirmation } from "../render/terminal/start.js";
import { START_MIN_WIDTH } from "../render/terminal/start-frame.js";
import { safeText } from "../render/tui/text.js";
import { terminalWidth } from "../render/terminal/text.js";

interface StartFlags { scope?: string[]; passive?: boolean; review?: boolean; agent?: string }

export function registerStart(program: Command, options: ProgramOptions, palette: Palette = plainPalette): void {
  program
    .command("start")
    .description("Begin a new session")
    .argument("[intent]", "what you are setting out to do")
    .option("--scope <paths...>", "paths you expect to change")
    .option("--review", "review and edit an agreement before accepting and starting (interactive)")
    .option("--passive", "for the editor hook: open an undeclared session, or do nothing")
    .option("--agent <name>", "for the editor hook: which coding tool's hook this is")
    .action((intent: string | undefined, flags: StartFlags) => routeStart(intent, flags, options, palette));
}

async function routeStart(intent: string | undefined, flags: StartFlags, options: ProgramOptions, palette: Palette): Promise<void> {
  if (flags.passive) return startPassive(flags, options);
  if (intent !== undefined) return startDeclared(intent, flags, options);
  if (flags.review) throw new Error('No intent given. Run: session start "what you are about to do"');
  const declaration = await readStartPrompt({ ...options, scope: flags.scope });
  printLines([""]);
  if (declaration === undefined) {
    printLines(["  Cancelled. No session started."]);
    return;
  }
  return startDeclared(declaration.intent, { ...flags, scope: declaration.scope }, options,
    session => {
      const width = terminalWidth(options.startTerminal?.output, START_MIN_WIDTH);
      return formatStartConfirmation(session, palette, formatStarted(session).slice(2), width);
    });
}

/** Hook stdout becomes editor context, so the passive route stays silent. */
async function startPassive(flags: StartFlags, options: ProgramOptions): Promise<void> {
  if (flags.review) throw new Error("--review cannot be combined with --passive. Review a declared session instead.");
  const agent = flags.agent !== undefined && /^[a-z0-9-]{1,32}$/.test(flags.agent) ? flags.agent : undefined;
  await startFromHook(options, await hookPayloadFrom(options.stdin), agent);
}

async function startDeclared(intent: string, flags: StartFlags, options: ProgramOptions,
  formatter: (session: Session) => string[] = formatStarted): Promise<void> {
  const closed: string[] = [];
  const startOptions = {
    ...options, scope: flags.scope,
    onCapturedClosed: (stopped: Session) => closed.push(formatClosedCaptured(stopped)),
  };
  const session = flags.review ? await startReviewed(intent, startOptions) : await startSession(intent, startOptions);
  printLines([...closed.map(safeText), ...(session ? formatter(session) : ["  Cancelled. No session started."])]);
}
