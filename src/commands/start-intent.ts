import { formatIntentPrompt } from "../render/terminal/start-intent.js";
import type { PromptTerminal } from "./prompt-terminal.js";

/** Read one declaration from the caller's cooked input reader. */
export async function promptIntent(
  answers: AsyncIterator<string>,
  output: PromptTerminal["output"],
): Promise<string | undefined> {
  output.write(formatIntentPrompt().join("\n"));
  const answer = await answers.next();
  if (answer.done) return undefined;
  const intent = answer.value.trim();
  if (intent === "") {
    throw new Error("No intent given. Write what you are working on before starting.");
  }
  return intent;
}
