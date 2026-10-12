import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { createPromptReader } from "../src/commands/prompt-reader.js";
import { ansiPalette } from "../src/render/palette.js";

const root = path.join(import.meta.dirname, "../src");
function sources(dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : entry.name.endsWith(".ts") ? [file] : [];
  });
}
it.each([
  ["raw input acquisition", /\bsetRawMode\b/u], ["keypress decoding", /\bemitKeypressEvents\b/u],
  ["alternate screens and bracketed paste modes", /(?:\\u001b|\u001b)\[\?(?:1049|2004)[hl]/u],
] as const)("keeps %s out of the inline CLI source", (_name, prohibited) => {
  const offending = sources().filter((file) => prohibited.test(readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
  expect(offending).toEqual([]);
});
it("retains cooked line reading and basic palette color", async () => {
  const input = new PassThrough(); const output = new PassThrough(); const reader = createPromptReader({ input, output });
  try {
    const answers = reader[Symbol.asyncIterator](); input.end("café\n"); expect((await answers.next()).value).toBe("café");
    const colored = ansiPalette.recording("recording"); expect(stripVTControlCharacters(colored)).toBe("recording");
    expect(colored.replace(/\u001b\[\d+m/gu, "")).toBe("recording");
  } finally { reader.close(); input.destroy(); output.destroy(); }
});
