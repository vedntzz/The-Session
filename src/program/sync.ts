// `session push`, `pull` and `peers`.
import type { Command } from "commander";
import { formatPeers, formatPull, formatPush, listPeers, pullPeers, pushLog } from "../sync.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerSync(program: Command, options: ProgramOptions): void {
  program
    .command("push")
    .description("Publish this machine's records to origin, on a ref of their own")
    .action(async () => {
      printLines(formatPush(await pushLog(options)));
    });

  program
    .command("pull")
    .description("Fetch every key's records from origin. Nothing is merged into your log")
    .action(async () => {
      printLines(formatPull(await pullPeers(options)));
    });

  program
    .command("peers")
    .description("The keys whose records are on this machine, and what they hold")
    .action(async () => {
      printLines(formatPeers(await listPeers(options)));
    });
}
