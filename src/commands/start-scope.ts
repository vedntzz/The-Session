import type { PromptTerminal } from "./prompt-terminal.js";

/** Read literal paths without taking ownership of the caller's reader. */
export async function promptScope(
  answers: AsyncIterator<string>,
  output: PromptTerminal["output"],
): Promise<string[] | undefined> {
  output.write("  Which files? Enter to skip.\n  One file or folder per line; an empty line finishes.\n  › ");
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
