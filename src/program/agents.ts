// `session agents`: each agent's sessions over all recorded history, or the last --days.
import type { Command } from "commander";
import { agentBlocks } from "../agents-report.js";
import { knownAgents } from "../capture/index.js";
import { agentSessions } from "../commands/agents.js";
import { sweepFirst } from "../commands/sweep.js";
import { parseDays } from "../commands/week.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatAgents, terminalWidth } from "../render/terminal.js";
import { storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/** All history by default: a comparison between agents needs volume, and a week holds too few sessions. */
export function registerAgents(program: Command, options: ProgramOptions, palette: Palette): void {
  program
    .command("agents")
    .description("Each coding agent's sessions: writes checked, merged, survived 30 days, cost")
    .option("--days <n>", "only sessions started in the last n days (default: all recorded history)")
    .action(async (flags: { days?: string }) => {
      const days = flags.days === undefined ? undefined : parseDays(flags.days);
      const { notice, facts } = await sweepFirst(options);
      const { sessions, checks } = await agentSessions(days, options, facts);
      const inputs = { known: knownAgents(), checks, rates: await loadRates(storeHome(options)), now: Date.now() };
      printLines([...notice, ...formatAgents(agentBlocks(sessions, inputs), sessions.length, days, palette, terminalWidth())]);
    });
}
