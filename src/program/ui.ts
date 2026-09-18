import type { Command } from "commander";
import { loadUi, requireTerminal, runUi } from "../commands/ui.js";
import { parseDays, DEFAULT_DAYS } from "../commands/week.js";
import type { Palette } from "../render/palette.js";
import type { ProgramOptions } from "./options.js";

export function registerUi(program: Command, options: ProgramOptions, palette: Palette): void {
  program.command("ui")
    .description("Browse sessions in an interactive terminal interface")
    .option("--days <n>", "how many days back to look", String(DEFAULT_DAYS))
    .action(async (flags: { days: string }) => {
      const days = parseDays(flags.days);
      requireTerminal({ input: process.stdin, output: process.stdout });
      const refresh = (): ReturnType<typeof loadUi> => loadUi(days, options);
      await runUi(await refresh(), refresh, palette);
    });
}
