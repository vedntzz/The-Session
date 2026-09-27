/**
 * What a developer typed, out of Claude Code's UserPromptSubmit `prompt`.
 *
 * A paste arrives in that field as its text behind an opening
 * `<pasted_content id="…">` tag, with no closing tag: every pasted prompt in
 * the transcripts on this machine had that shape, the text after the tag and
 * nothing else of Claude Code's around it. The tag is the editor's markup and
 * the text is the developer's, so the tag goes and the text stays — nothing
 * else in the prompt is touched. A closing tag is dropped too, should one ever
 * arrive, since it would be markup of the same kind.
 *
 * Only the tag with an `id` is markup. A prompt asking about `<pasted_content>`
 * is somebody's words, and stays as they are.
 */

const OPEN = /<pasted_content id="[^"]*">/gu;
const CLOSE = /<\/pasted_content>/gu;

export interface UnwrappedPrompt {
  /** The prompt with the paste markup removed. */
  text: string;
  /** A paste tag was there and nothing else was: the payload carried no words. */
  pasteOnly: boolean;
}

export function unwrapPastes(prompt: string): UnwrappedPrompt {
  const text = prompt.replace(OPEN, "");
  if (text === prompt) {
    return { text: prompt, pasteOnly: false };
  }
  const unwrapped = text.replace(CLOSE, "");
  return { text: unwrapped, pasteOnly: unwrapped.trim() === "" };
}
