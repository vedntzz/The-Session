import type { StoreOptions } from "../store.js";
import { assertStartAvailable } from "./start-conditions.js";
import { promptIntent } from "./start-intent.js";
import { promptScope } from "./start-scope.js";
import { withPromptReader } from "./prompt-lifecycle.js";
import type { PromptTerminal } from "./prompt-terminal.js";

/** Collect a declaration before the backend creates or closes any session. */
export async function readStartPrompt(options: StoreOptions & { startTerminal?: PromptTerminal; scope?: string[] } = {}): Promise<{ intent: string; scope?: string[] } | undefined> {
  const terminal = options.startTerminal ?? { input: process.stdin, output: process.stdout };
  if (!terminal.input.isTTY || !terminal.output.isTTY) {
    throw new Error('No intent given. Run: session start "what you are about to do"');
  }
  await assertStartAvailable(options);
  return withPromptReader(terminal, answers => collectStartPrompt(answers, terminal.output, options.scope));
}

async function collectStartPrompt(answers: AsyncIterator<string>, output: PromptTerminal["output"], provided?: string[]): Promise<{ intent: string; scope?: string[] } | undefined> {
  const intent = await promptIntent(answers, output);
  if (intent === undefined) return undefined;
  if (provided !== undefined) return { intent, scope: provided };
  const scope = await promptScope(answers, output);
  if (scope === undefined) return undefined;
  return scope.length > 0 ? { intent, scope } : { intent };
}
