// `session start`.
import type { Command } from "commander";
import { formatClosedCaptured, formatStarted, startSession } from "../commands/start.js";
import { startFromHook } from "../commands/agent-session.js";
import { hookPayloadFrom } from "../capture/adapters/hook-payload.js";
import type { Session } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";
import { startReviewed } from "../commands/review.js";

export function registerStart(program: Command, options: ProgramOptions): void {
  program
    .command("start")
    .description("Begin a new session")
    .argument("[intent]", "what you are setting out to do")
    .option("--scope <paths...>", "paths you expect to change")
    .option("--review", "review and edit an agreement before accepting and starting (interactive)")
    .option("--passive", "for the editor hook: open an undeclared session, or do nothing")
    .option("--agent <name>", "for the editor hook: which coding tool's hook this is")
    .action(async (intent: string | undefined, flags: { scope?: string[]; passive?: boolean; review?: boolean; agent?: string }) => {
      // The hook's half of the command, and it prints nothing either way. A
      // SessionStart handler's stdout is fed to the agent as context, so a
      // line here would arrive inside somebody's prompt.
      if (flags.passive) {
        if (flags.review) throw new Error("--review cannot be combined with --passive. Review a declared session instead.");
        const agent = flags.agent !== undefined && /^[a-z0-9-]{1,32}$/.test(flags.agent) ? flags.agent : undefined;
        await startFromHook(options, await hookPayloadFrom(options.stdin), agent);
        return;
      }

      if (intent === undefined) {
        throw new Error('No intent given. Run: session start "what you are about to do"');
      }
      const closed: string[] = [];
      const startOptions = {
        ...options,
        scope: flags.scope,
        onCapturedClosed: (stopped: Session) => closed.push(formatClosedCaptured(stopped)),
      };
      const session = flags.review
        ? await startReviewed(intent, startOptions)
        : await startSession(intent, startOptions);
      printLines([...closed, ...(session ? formatStarted(session) : ["  Cancelled. No session started."])]);
    });
}
