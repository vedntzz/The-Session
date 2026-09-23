// Commands known to write no file. Everything here is waved through once the
// shell check is wired in, so the list is short on purpose: a program is on it
// only when none of its options can write a file, run another program, or
// name an output. Anything else — including a read-only program used with a
// writing option — is unknown, which the check turns into a question.
import type { ShellWrites } from "./package-manager.js";
import { simpleWords } from "./words.js";

const UNKNOWN: ShellWrites = { kind: "unknown" };
const NOTHING: ShellWrites = { kind: "writes", paths: [] };

/** No option of these writes a file or runs a program; any arguments will do. */
const ANY_ARGUMENTS = new Set([
  "cat", "head", "tail", "wc", "ls", "pwd", "echo", "true", "false",
  "grep", "egrep", "fgrep", "diff", "cmp", "stat", "du", "df",
  "which", "basename", "dirname", "realpath", "readlink", "whoami", "uname",
]);

/** find's actions that delete, run a program, or write a listing to a file. */
const FIND_WRITERS = new Set([
  "-delete", "-exec", "-execdir", "-ok", "-okdir",
  "-fprint", "-fprint0", "-fprintf", "-fls",
]);

/** git subcommands that read. The index lock git status may refresh is under
 * .git, which no agreement path or diff covers. */
const GIT_READERS = new Set([
  "status", "log", "diff", "show", "blame", "ls-files", "rev-parse", "describe", "shortlog",
]);

/** Options that turn a git reader into a writer or a program runner. */
function gitWriterOption(arg: string): boolean {
  return arg === "--output" || arg.startsWith("--output=") || arg === "--ext-diff";
}

/**
 * `{ kind: "writes", paths: [] }` when the command is one simple command known
 * to write no file, otherwise unknown. Unknown is never "writes nothing": it is
 * the answer for every program not listed here.
 */
export function readOnlyWrites(command: string): ShellWrites {
  const words = simpleWords(command);
  if (!words) return UNKNOWN;
  const [program, ...args] = words;
  if (ANY_ARGUMENTS.has(program!)) return NOTHING;
  if (program === "find") {
    return args.some((arg) => FIND_WRITERS.has(arg)) ? UNKNOWN : NOTHING;
  }
  if (program === "git") return gitReadOnly(args) ? NOTHING : UNKNOWN;
  return UNKNOWN;
}

/**
 * A git reader, named first: a global option before the subcommand (`-C`,
 * `-c`, `--git-dir`, `--work-tree`) can point git at another repository or
 * change what it runs, so none is accepted. `branch` and `remote` read only in
 * their listing forms; with a name they create, rename or delete.
 */
function gitReadOnly(args: readonly string[]): boolean {
  const [sub, ...rest] = args;
  if (sub === undefined || rest.some(gitWriterOption)) return false;
  if (GIT_READERS.has(sub)) return true;
  if (sub === "branch") {
    return rest.every((arg) => ["-a", "--all", "-r", "--remotes", "-v", "-vv", "--list", "--show-current"].includes(arg));
  }
  if (sub === "remote") return rest.every((arg) => arg === "-v" || arg === "--verbose");
  return false;
}
