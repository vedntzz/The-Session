// Named outputs of one simple tee command, not the writes of a pipeline.
import type { ShellWrites } from "./package-manager.js";
import { simpleWords } from "./words.js";

const UNKNOWN: ShellWrites = { kind: "unknown" };

/**
 * Return every literal file operand, for overwrite or append. stdout is not
 * a named file here; its inherited destination is outside this parser's
 * knowledge. Never infer read-only from an empty operand list.
 */
export function teeWrites(command: string): ShellWrites {
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(command)) return UNKNOWN;
  const words = simpleWords(command);
  if (!words || words[0] !== "tee") return UNKNOWN;
  const paths: string[] = [];
  let optionsEnded = false;
  for (const word of words.slice(1)) {
    if (!optionsEnded && word === "--" && paths.length === 0) {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && word.startsWith("-")) {
      // Do not guess option permutation across GNU/BSD implementations.
      if (paths.length > 0) return UNKNOWN;
      if (/^-[ai]+$/.test(word) || word === "--append" || word === "--ignore-interrupts") continue;
      return UNKNOWN;
    }
    // '-' has changed meaning across versions. Devices/descriptors also do
    // not describe ordinary persistent files, so leave those unknown.
    if (word === "" || word === "-" || /^\/dev(?:\/|$)/.test(word)) return UNKNOWN;
    paths.push(word);
  }
  return paths.length > 0 ? { kind: "writes", paths: [...new Set(paths)] } : UNKNOWN;
}
