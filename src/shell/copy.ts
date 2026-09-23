import { simpleWords } from "./words.js";

export type CopyOverwrite = "default" | "interactive" | "no-clobber";
export type CopyRequest =
  | { kind: "copy"; source: string; destination: string; overwrite: CopyOverwrite }
  | { kind: "unknown" };
const UNKNOWN: CopyRequest = { kind: "unknown" };

/** Two literal operands, no recursive, link, backup or force semantics. */
export function parseCopy(command: string): CopyRequest {
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(command)) return UNKNOWN;
  const words = simpleWords(command);
  if (!words || words[0] !== "cp") return UNKNOWN;
  let i = 1;
  let overwrite: CopyOverwrite = "default";
  if (words[i] === "-i" || words[i] === "-n") {
    overwrite = words[i] === "-i" ? "interactive" : "no-clobber";
    i++;
  }
  const optionsEnded = words[i] === "--";
  if (optionsEnded) i++;
  const operands = words.slice(i);
  if (operands.length !== 2 || operands.some((word) => word === "" ||
    (!optionsEnded && word.startsWith("-")) || /^\/dev(?:\/|$)/.test(word))) return UNKNOWN;
  return { kind: "copy", source: operands[0]!, destination: operands[1]!, overwrite };
}
