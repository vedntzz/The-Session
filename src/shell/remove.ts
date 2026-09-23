// A removal names files to delete. Like a move, it is a request, not a write
// set: whether each operand is a file, a link or a directory is a filesystem
// question, answered by resolveRemove.
import { simpleWords } from "./words.js";

export type RemoveRequest =
  | { kind: "remove"; paths: readonly string[]; force: boolean }
  | { kind: "unknown" };

const UNKNOWN: RemoveRequest = { kind: "unknown" };

/**
 * Parse one rm with literal operands and at most one of -f or -i. Recursive
 * and directory removal (-r, -R, --recursive, -d) and every other option are
 * unknown: a directory's contents cannot be told from the command. `--` ends
 * options, so a file named like a flag can still be named.
 */
export function parseRemove(command: string): RemoveRequest {
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(command)) return UNKNOWN;
  const words = simpleWords(command);
  if (!words || words[0] !== "rm") return UNKNOWN;
  let i = 1;
  let force = false;
  if (words[i] === "-f" || words[i] === "-i") {
    force = words[i] === "-f";
    i++;
  }
  const optionsEnded = words[i] === "--";
  if (optionsEnded) i++;
  const operands = words.slice(i);
  if (operands.length === 0 || operands.some((word) => word === "" ||
    (!optionsEnded && word.startsWith("-")) || /^\/dev(?:\/|$)/.test(word))) return UNKNOWN;
  return { kind: "remove", paths: operands, force };
}
