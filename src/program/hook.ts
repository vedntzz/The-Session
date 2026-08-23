// `session hook`.
import type { Command } from "commander";
import { formatHook, installHook, uninstallHook } from "../commands/hook.js";
import type { ProgramOptions } from "./options.js";
import { parseFlag } from "./options.js";
import { printLines } from "./print.js";

export function registerHook(program: Command, options: ProgramOptions): void {
  const hook = program.command("hook").description("Manage the editor hook that closes sessions");

  hook
    .command("install")
    .description("Register the Claude Code hooks that open and close sessions")
    .option("--uninstall", "take the hooks back out instead")
    .option(
      "--passive [yes|no]",
      "record sessions nobody declared, from the first prompt onwards",
      parseFlag,
      true,
    )
    // The same answer spelled the way commander spells it. Both are here
    // because `--passive=false` is what anyone reading the other flag would
    // reach for, and `--no-passive` is what anyone reading a commander CLI
    // would.
    .option("--no-passive", "register only the hook that closes a session you started")
    .action(async (flags: { uninstall?: boolean; passive?: boolean }) => {
      const result = flags.uninstall
        ? await uninstallHook(options)
        : await installHook({ ...options, passive: flags.passive });
      printLines(formatHook(result));
    });
}
