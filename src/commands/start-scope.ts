import { formatScopePrompt } from "../render/terminal/start-scope.js";
import { plainPalette, type Palette } from "../render/palette.js";
import type { PromptTerminal } from "./prompt-terminal.js";

/** Read literal paths without taking ownership of the caller's reader. */
export async function promptScope(
  answers: AsyncIterator<string>,
  output: PromptTerminal["output"],
  palette: Palette = plainPalette,
): Promise<string[] | undefined> {
  output.write(formatScopePrompt(palette).join("\n"));
  const paths: string[] = [];
  while (true) {
    const answer = await answers.next();
    if (answer.done) return undefined;
    const path = answer.value.trim();
    if (path === "") return paths;
    paths.push(path);
    output.write("  › ");
  }
}
