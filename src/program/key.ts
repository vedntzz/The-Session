// `session key`.
import type { Command } from "commander";
import { formatKey, showKey } from "../commands/key.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerKey(program: Command, options: ProgramOptions): void {
  const key = program.command("key").description("The signing key this machine writes with");

  key
    .command("show")
    .description("Print the public key, for anyone who wants to check the log")
    .action(async () => {
      printLines(formatKey(await showKey(options), options));
    });
}
