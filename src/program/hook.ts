// `session hook`.
import type { Command } from "commander";
import { formatHook, installEnforce, installHook, uninstallHook } from "../commands/hook.js";
import type { ProgramOptions } from "./options.js";
import { parseFlag } from "./options.js";
import { printLines } from "./print.js";
import { checkWrite } from "../commands/check-write.js";

export function registerHook(program: Command, options: ProgramOptions): void {
  const hook = program.command("hook").description("Manage the editor hook that closes sessions");

  hook.command("check")
    .description("Check a PreToolUse write against the open session's agreement")
    .action(async () => {
      const result = await checkWrite(options);
      if (result !== "") console.log(result);
    });

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
    .option("--enforce", "check writes against the open agreement, in this repository only")
    .action(async (flags: { uninstall?: boolean; passive?: boolean; enforce?: boolean }, command: Command) => {
      if (flags.enforce) {
        // The check is a separate, per-repository arrangement; a flag meant for
        // the user-level hooks is refused by name rather than quietly ignored.
        if (flags.uninstall) {
          throw new Error("--enforce cannot be combined with --uninstall yet. Remove the session hook check entry from .claude/settings.local.json by hand.");
        }
        if (command.getOptionValueSource("passive") === "cli") {
          throw new Error("--passive applies to the user-level hooks, not --enforce. Run session hook install separately for those.");
        }
        printLines(formatHook(await installEnforce(options)));
        return;
      }
      const result = flags.uninstall
        ? await uninstallHook(options)
        : await installHook({ ...options, passive: flags.passive });
      printLines(formatHook(result));
    });
}
