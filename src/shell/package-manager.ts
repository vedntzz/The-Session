// Which tracked files an npm, pnpm or yarn command writes, when that can be
// told from the command alone. Pure: no filesystem, no process, no guess.
import { simpleWords } from "./words.js";

/**
 * Files a command writes, relative to the directory it runs in, or unknown.
 * `writes` with no paths means none of the tracked files — not that the
 * command writes nothing: `node_modules` and the package manager's caches are
 * written regardless, and are not tracked.
 */
export type ShellWrites =
  | { kind: "writes"; paths: readonly string[] }
  | { kind: "unknown" };

const UNKNOWN: ShellWrites = { kind: "unknown" };

type Change = "add" | "install" | "remove" | "update" | "clean-install";

interface Manager {
  manifest: string;
  lockfile: string;
  /** Subcommand spellings, to what each does to the tracked files. */
  commands: Record<string, Change>;
  /** Flags that change nothing about which files are written. */
  flags: readonly string[];
  /** Flags that forbid touching the lockfile and manifest. */
  frozen: readonly string[];
}

const SAVE_FLAGS = ["-D", "--save-dev", "-P", "--save-prod", "-O", "--save-optional", "-E", "--save-exact"];
const QUIET_FLAGS = ["--ignore-scripts", "--prefer-offline", "--silent", "-s"];

const MANAGERS: Record<string, Manager> = {
  npm: {
    manifest: "package.json",
    lockfile: "package-lock.json",
    commands: {
      install: "install", i: "install", in: "install", add: "install",
      uninstall: "remove", un: "remove", unlink: "remove", remove: "remove", rm: "remove", r: "remove",
      update: "update", up: "update", upgrade: "update",
      ci: "clean-install",
    },
    flags: [...SAVE_FLAGS, ...QUIET_FLAGS, "-B", "--save-bundle", "--save", "--legacy-peer-deps",
      "--force", "--no-audit", "--no-fund", "--quiet", "-q"],
    frozen: ["--no-save"],
  },
  pnpm: {
    manifest: "package.json",
    lockfile: "pnpm-lock.yaml",
    commands: {
      add: "add", install: "install", i: "install",
      remove: "remove", rm: "remove", uninstall: "remove", un: "remove",
      update: "update", up: "update", upgrade: "update",
    },
    flags: [...SAVE_FLAGS, ...QUIET_FLAGS, "--latest", "-L"],
    frozen: ["--frozen-lockfile"],
  },
  yarn: {
    manifest: "package.json",
    lockfile: "yarn.lock",
    commands: {
      add: "add", install: "install", remove: "remove", upgrade: "update", up: "update",
    },
    flags: ["-D", "--dev", "-P", "--peer", "-O", "--optional", "-E", "--exact", ...QUIET_FLAGS],
    frozen: ["--frozen-lockfile", "--immutable"],
  },
};

/**
 * The tracked files a package-manager command writes. Recognition is
 * positive: one simple command, a known manager and subcommand, and only
 * flags listed above. A global install, another directory (`--prefix`, `-C`,
 * `--dir`, `--cwd`), a workspace flag or any unlisted flag is unknown. Where
 * the manager's behaviour varies by version, the answer lists more files, not
 * fewer: an extra path can only make the check stricter.
 */
export function packageManagerWrites(command: string): ShellWrites {
  const words = simpleWords(command);
  if (!words) return UNKNOWN;
  const [program, ...rest] = words;
  const manager = MANAGERS[program!];
  if (!manager) return UNKNOWN;
  // Bare `yarn` is `yarn install`; bare npm and pnpm print help.
  const [sub, ...args] = rest.length === 0 && program === "yarn" ? ["install"] : rest;
  const change = sub === undefined ? undefined : Object.hasOwn(manager.commands, sub) ? manager.commands[sub] : undefined;
  if (!change) return UNKNOWN;

  const flags = args.filter((arg) => arg.startsWith("-"));
  const packages = args.filter((arg) => !arg.startsWith("-"));
  if (flags.some((flag) => !manager.flags.includes(flag) && !manager.frozen.includes(flag))) return UNKNOWN;
  const frozen = flags.some((flag) => manager.frozen.includes(flag));

  const both = [manager.manifest, manager.lockfile];
  switch (change) {
    case "clean-install":
      return packages.length === 0 ? { kind: "writes", paths: [] } : UNKNOWN;
    case "add":
      if (packages.length === 0) return UNKNOWN;
      return { kind: "writes", paths: frozen ? [] : both };
    case "remove":
      if (packages.length === 0) return UNKNOWN;
      return { kind: "writes", paths: frozen ? [] : both };
    case "install":
      // npm install <pkg> adds; pnpm and yarn refuse packages here, so an
      // install with packages is only recognised for npm.
      if (packages.length > 0) {
        return program === "npm" ? { kind: "writes", paths: frozen ? [] : both } : UNKNOWN;
      }
      return { kind: "writes", paths: frozen ? [] : [manager.lockfile] };
    case "update":
      return { kind: "writes", paths: frozen ? [] : both };
  }
}
