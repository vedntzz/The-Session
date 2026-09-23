// A deliberately small output-redirection grammar, not a shell evaluator.
import type { ShellWrites } from "./package-manager.js";
import { simpleWords } from "./words.js";

const UNKNOWN: ShellWrites = { kind: "unknown" };

/**
 * Recognize a single trailing stdout `>` for a bare redirect, echo or colon.
 * Arbitrary commands may write beyond their redirected output, so do not
 * return a partial write set for them. Assumes ordinary shell builtins, not
 * user-defined functions/aliases. No filesystem access or command execution.
 */
export function redirectWrites(command: string): ShellWrites {
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(command)) return UNKNOWN;
  const index = redirectIndex(command);
  if (index === undefined) return UNKNOWN;
  const before = command.slice(0, index);
  const words = before.trim() === "" ? [] : simpleWords(before);
  if (!words || (words.length > 0 && words[0] !== "echo" && words[0] !== ":")) return UNKNOWN;
  // Prefix a fixed word so a filename like A=b is not treated as an env
  // assignment. The target must still be exactly one literal shell word.
  const target = simpleWords(`target ${command.slice(index + 1)}`);
  if (!target || target.length !== 2 || target[1] === "") return UNKNOWN;
  // Bash gives /dev/tcp, /dev/udp and descriptor paths special behavior;
  // do not describe those as ordinary filesystem writes.
  if (/^\/dev(?:\/|$)/.test(target[1]!)) return UNKNOWN;
  return { kind: "writes", paths: [target[1]!] };
}

/** Find exactly one unquoted >; simpleWords validates each side afterward. */
function redirectIndex(command: string): number | undefined {
  let quote: "'" | '"' | undefined;
  let found: number | undefined;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ">") {
      // Numeric descriptors are deliberately unsupported, as are >> and
      // every second redirect. Other operators are refused by simpleWords.
      if (found !== undefined || (i > 0 && /[0-9]/.test(command[i - 1]!))) return undefined;
      found = i;
    }
  }
  return quote === undefined ? found : undefined;
}
