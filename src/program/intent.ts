// `session intent`, the hook's prompt capture.
import type { Command } from "commander";
import { captureFromPrompt, promptFromHook, readHookPayload } from "../commands/intent.js";
import { startPassiveSession } from "../commands/start.js";
import type { ProgramOptions } from "./options.js";

export function registerIntent(program: Command, options: ProgramOptions): void {
  program
    .command("intent")
    .description("For the editor hook: record the first prompt as an undeclared session's intent")
    .requiredOption("--from-prompt", "read the Claude Code hook payload on stdin")
    .action(() => captureQuietly(options));
}

/**
 * Records the prompt as an intent, and swallows everything.
 *
 * Nothing is printed and nothing throws. This runs between a developer
 * pressing enter and the agent starting: a UserPromptSubmit handler that
 * exits non-zero blocks the prompt outright, and one that prints is adding
 * text to it. A recorder that can eat a prompt is worse than no recorder.
 */
async function captureQuietly(options: ProgramOptions): Promise<void> {
  try {
    const payload = await readHookPayload(options.stdin ?? process.stdin);
    const prompt = promptFromHook(payload);
    if (prompt !== undefined) {
      await captureFromPrompt(prompt, options);
    }
  } catch {
    // The session keeps whatever it had, which is nothing, and the next
    // prompt tries again.
  }
}
