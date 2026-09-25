// `session hook`.
import type { Command } from "commander";
import { formatHook, installRepoHooks, installHook, uninstallRepoHooks, uninstallHook } from "../commands/hook.js";
import type { ProgramOptions } from "./options.js";
import { parseFlag } from "./options.js";
import { printLines } from "./print.js";
import { checkWrite } from "../commands/check-write.js";

export function registerHook(program: Command, options: ProgramOptions): void {
  const hook = program.command("hook").description("Manage the editor hook that closes sessions");

  hook.command("check")
    .description("Check a PreToolUse write against the open session's agreement")
    .action(async () => {
      try {
        const result = await checkWrite(options);
        if (result !== "") console.log(result);
      } catch {
        // Anything that escapes the check would otherwise exit 1, which the host
        // reads as a non-blocking error and lets the write through. Exit 2 blocks.
        process.stderr.write("Write check failed unexpectedly. Run session hook check by hand to see why, then retry.\n");
        process.exitCode = 2;
      } finally {
        // An answer given at the deadline must not wait on a stdin that never closed.
        if (options.stdin === undefined) {
          process.stdin.destroy();
          // Work abandoned at a deadline — a read, a wait on the log's lock —
          // must not hold the process open past the host's timeout, which lets
          // the write through. Exit once the answer is flushed.
          process.stdout.write("", () => process.exit());
        }
      }
    });

  hook
    .command("install")
    .description("Register the Claude Code hooks that open and close sessions")
    .option("--uninstall", "take the hooks back out instead (with --repo, only the check)")
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
    .option("--repo", "register this repository's own hooks (the agreement check), in .claude/settings.local.json")
    .action(async (flags: { uninstall?: boolean; passive?: boolean; repo?: boolean }, command: Command) => {
      if (flags.repo) {
        // The check is a separate, per-repository arrangement; a flag meant for
        // the user-level hooks is refused by name rather than quietly ignored.
        if (command.getOptionValueSource("passive") === "cli") {
          throw new Error("--passive applies to the user-level hooks, not --repo. Run session hook install separately for those.");
        }
        printLines(formatHook(flags.uninstall ? await uninstallRepoHooks(options) : await installRepoHooks(options)));
        return;
      }
      const result = flags.uninstall
        ? await uninstallHook(options)
        : await installHook({ ...options, passive: flags.passive });
      printLines(formatHook(result));
    });
}
