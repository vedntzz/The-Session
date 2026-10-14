import { formatStartPromptHeader } from "../render/terminal/start-prompt-header.js";
import { START_MIN_WIDTH } from "../render/terminal/start-frame.js";
import { terminalWidth } from "../render/terminal/text.js";
import { plainPalette, type Palette } from "../render/palette.js";
import type { StoreOptions } from "../store.js";
import { assertStartAvailable } from "./start-conditions.js";
import { promptIntent } from "./start-intent.js";
import { promptScope } from "./start-scope.js";
import { withPromptReader } from "./prompt-lifecycle.js";
import type { PromptTerminal } from "./prompt-terminal.js";

type Declaration = { intent: string; scope?: string[] };

/** Collect a declaration before the backend creates or closes any session. */
export async function readStartPrompt(
  options: StoreOptions & { startTerminal?: PromptTerminal; scope?: string[] } = {},
  palette: Palette = plainPalette,
): Promise<Declaration | undefined> {
  const terminal = options.startTerminal ?? { input: process.stdin, output: process.stdout };
  if (!terminal.input.isTTY || !terminal.output.isTTY) {
    throw new Error('No intent given. Run: session start "what you are about to do"');
  }
  await assertStartAvailable(options);
  return withPromptReader(terminal, answers => collectStartPrompt(answers, terminal.output, palette, options.scope));
}

async function collectStartPrompt(
  answers: AsyncIterator<string>,
  output: PromptTerminal["output"],
  palette: Palette,
  provided?: string[],
): Promise<Declaration | undefined> {
  const width = terminalWidth(output, START_MIN_WIDTH);
  output.write(formatStartPromptHeader(palette, width).join("\n") + "\n");
  const intent = await promptIntent(answers, output, palette);
  if (intent === undefined) return undefined;
  if (provided !== undefined) return { intent, scope: provided };
  const scope = await promptScope(answers, output);
  if (scope === undefined) return undefined;
  return scope.length > 0 ? { intent, scope } : { intent };
}
