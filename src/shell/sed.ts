// Positive recognition of a small in-place sed subset. Never execute a script.
import type { ShellWrites } from "./package-manager.js";
import { simpleWords } from "./words.js";

export type SedDialect = "gnu" | "macos";
const UNKNOWN: ShellWrites = { kind: "unknown" };

/**
 * Persistent operand/backup paths only, not sed's temporary files. The caller
 * must know which sed runs; the operating system alone does not establish it.
 * No dialect supplied means unknown, not a guess based on this process's OS.
 */
export function sedWrites(command: string, dialect?: SedDialect): ShellWrites {
  if (dialect !== "gnu" && dialect !== "macos") return UNKNOWN;
  const words = simpleWords(command);
  if (!words || words[0] !== "sed") return UNKNOWN;
  let i = 1;
  let suffix: string | undefined;
  const scripts: string[] = [];
  while (i < words.length) {
    const word = words[i]!;
    if (word === "--" && dialect === "gnu") { i++; break; }
    if (!word.startsWith("-")) break;
    i++;
    if (word === "-n" || word === "-E") continue;
    if (word === "-e") {
      const script = words[i++];
      if (script === undefined) return UNKNOWN;
      scripts.push(script);
    } else if (word === "-i" || word.startsWith("-i") ||
      (dialect === "gnu" && (word === "--in-place" || word.startsWith("--in-place=")))) {
      if (suffix !== undefined) return UNKNOWN;
      if (word === "-i") suffix = dialect === "macos" ? words[i++] : "";
      else suffix = word.startsWith("-i") ? word.slice(2) : word.slice("--in-place".length).replace(/^=/, "");
      // GNU '*' rewrites the backup name; slash can move it elsewhere.
      // Restrict extensions rather than implement another path language.
      if (suffix === undefined || !/^[A-Za-z0-9._-]*$/.test(suffix)) return UNKNOWN;
    } else return UNKNOWN;
  }
  if (suffix === undefined) return UNKNOWN;
  if (scripts.length === 0) {
    const script = words[i++];
    if (script === undefined) return UNKNOWN;
    scripts.push(script);
  }
  // One slash-delimited substitution per expression. No addresses, escapes,
  // bracket expressions, commands, or e/w flags: they need a real sed parser.
  if (scripts.some((script) => !/^s\/[^/\\\[\]\r\n]*\/[^/\\\r\n]*\/[gp]*$/.test(script))) return UNKNOWN;
  const files = words.slice(i);
  if (files.length === 0 || files.some((file) => file === "" || file.startsWith("-") || /[\x00-\x1f\x7f]/.test(file))) return UNKNOWN;
  return { kind: "writes", paths: [...new Set(files.flatMap((file) => suffix === "" ? [file] : [file, file + suffix]))] };
}
