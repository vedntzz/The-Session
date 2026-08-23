// `session config`.
import type { Command } from "commander";
import { formatConfig, setConfig, showConfig } from "../commands/config.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerConfig(program: Command, options: ProgramOptions): void {
  const config = program
    .command("config")
    .description("Attribution for this repo, in .session.json — checked in, shared by the team");

  config
    .command("set")
    .description("Set an attribution field, recorded by every session from now on")
    .argument("<key>", "client, project, sow, or billingCode")
    .argument("<value>", "what to record; an empty value clears the field")
    .action(async (key: string, value: string) => {
      printLines(formatConfig(await setConfig(key, value, options.cwd)));
    });

  config
    .command("show")
    .description("Print the attribution this repo declares")
    .action(async () => {
      printLines(formatConfig(await showConfig(options.cwd)));
    });
}
