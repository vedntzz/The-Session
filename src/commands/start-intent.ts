import { formatStartPromptHeader } from "../render/terminal/start-prompt-header.js";
import { START_MIN_WIDTH } from "../render/terminal/start-frame.js";
import { terminalWidth } from "../render/terminal/text.js";
import { formatIntentPrompt } from "../render/terminal/start-intent.js";
import { plainPalette, type Palette } from "../render/palette.js";
import type { PromptTerminal } from "./prompt-terminal.js";

/** Read one declaration from the caller's cooked input reader. */
export async function promptIntent(
  answers: AsyncIterator<string>,
  output: PromptTerminal["output"],
  palette: Palette = plainPalette,
  scope?: readonly string[],
): Promise<string | undefined> {
  const width = terminalWidth(output, START_MIN_WIDTH);
  const header = formatStartPromptHeader(palette, width);
  output.write([...header, ...formatIntentPrompt(palette, width, scope)].join("\n"));
  const answer = await answers.next();
  if (answer.done) return undefined;
  const intent = answer.value.trim();
  if (intent === "") {
    throw new Error("No intent given. Write what you are working on before starting.");
  }
  return intent;
}
