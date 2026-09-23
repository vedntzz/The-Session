// A move has a source removal and a destination write. Do not flatten those
// into ShellWrites: directory destinations need filesystem resolution first.
import { simpleWords } from "./words.js";

export type MoveOverwrite = "default" | "force" | "interactive" | "no-clobber";
export type MoveRequest =
  | { kind: "move"; source: string; destination: string; overwrite: MoveOverwrite }
  | { kind: "unknown" };

const UNKNOWN: MoveRequest = { kind: "unknown" };

/**
 * Parse one mv with exactly two literal operands and at most one overwrite
 * option. A parsed request is NOT a resolved write set or permission: callers
 * must account for source deletion, destination type and directory contents.
 */
export function parseMove(command: string): MoveRequest {
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(command)) return UNKNOWN;
  const words = simpleWords(command);
  if (!words || words[0] !== "mv") return UNKNOWN;
  let i = 1;
  let overwrite: MoveOverwrite = "default";
  if (words[i] === "-f" || words[i] === "-i" || words[i] === "-n") {
    overwrite = words[i] === "-f" ? "force" : words[i] === "-i" ? "interactive" : "no-clobber";
    i++;
  }
  const optionsEnded = words[i] === "--";
  if (optionsEnded) i++;
  const operands = words.slice(i);
  if (operands.length !== 2 || operands.some((word) => word === "" ||
    (!optionsEnded && word.startsWith("-")) || /^\/dev(?:\/|$)/.test(word))) return UNKNOWN;
  return { kind: "move", source: operands[0]!, destination: operands[1]!, overwrite };
}
