// Formatting and recognizing the command lines our hook installer owns.
import type { HookSpec } from "./hook.js";

/**
 * The node binary and this package's `cli.js`, by absolute path, which is
 * what a registered hook runs instead of a bare `session`.
 *
 * An editor runs a hook through `/bin/sh`, which reads none of the developer's
 * shell startup files. Whatever put `session` on their PATH — nvm, Volta, a
 * Homebrew prefix — is not there, so a bare `session` exits 127 and the
 * session it was meant to open or close is silently never recorded. Both
 * paths are spelled out rather than the `session` shim, because the shim is
 * `#!/usr/bin/env node` and that PATH may have no `node` either.
 *
 * Absolute paths go stale when node or the package moves; installing again
 * rewrites them.
 */
export interface Launcher {
  readonly node: string;
  readonly cli: string;
}

/** A word as `/bin/sh` reads it back: bare when that is safe, single-quoted when not. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The subcommand and flags a hook passes, without the program name. */
function argsOf(hook: HookSpec, agent?: string): string[] {
  const agentArgs = hook.takesAgent && agent !== undefined ? ["--agent", agent] : [];
  return [...hook.command.split(" ").slice(1), ...agentArgs];
}

/** The hook's command as a person would type it, with the agent it names in this file. */
export function commandOf(hook: HookSpec, agent?: string): string {
  return ["session", ...argsOf(hook, agent)].join(" ");
}

/** The command line registered for a hook: the launcher, then its arguments. */
export function commandLine(hook: HookSpec, launcher: Launcher, agent?: string): string {
  return [shellWord(launcher.node), shellWord(launcher.cli), ...argsOf(hook, agent)].join(" ");
}

/** The launcher as it appears at the front of every registered command. */
export function launcherLine(launcher: Launcher): string {
  return `${shellWord(launcher.node)} ${shellWord(launcher.cli)}`;
}

/**
 * The words of a command line, for the two spellings `shellWord` writes: bare
 * words and single-quoted ones. Anything else — double quotes, a backslash,
 * an operator — is not a command this tool wrote, and reads as undefined.
 */
function wordsOf(command: string): string[] | undefined {
  const words: string[] = [];
  let word: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return undefined;
      word = (word ?? "") + command.slice(i + 1, end);
      i = end;
    } else if (char === "\\" && command[i + 1] === "'") {
      word = (word ?? "") + "'";
      i++;
    } else if (/[\w@%+=:,./-]/.test(char)) {
      word = (word ?? "") + char;
    } else {
      return undefined;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/**
 * True when a command line runs this hook, however `session` was spelled: bare
 * (every install before this one), an absolute path to a `session` shim (a
 * hand repair), or a node binary and a `cli.js` (this install, or an earlier
 * one whose paths have since moved). The arguments must match exactly, so a
 * hook somebody else wrote around `session` is not taken for ours — less a
 * trailing `--agent <name>` on a hook that takes one, so an entry naming no
 * agent, or another, is still ours to repair or remove.
 */
export function runsHook(command: string, hook: HookSpec): boolean {
  const named = wordsOf(command);
  if (named === undefined) return false;
  const words = hook.takesAgent && named.at(-2) === "--agent" ? named.slice(0, -2) : named;
  const args = argsOf(hook);
  const head = words.slice(0, words.length - args.length);
  if (words.slice(head.length).join(" ") !== args.join(" ")) return false;
  if (head.length === 1) {
    return head[0] === "session" || (head[0]!.startsWith("/") && baseName(head[0]!) === "session");
  }
  return head.length === 2 && head.every((word) => word.startsWith("/")) && baseName(head[1]!) === "cli.js";
}

