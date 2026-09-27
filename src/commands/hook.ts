import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bareSessionCommands,
  CHECK_HOOK,
  hasEntry,
  hasHook,
  hasHooks,
  wantedHooks,
  withHook,
  withHooks,
  withoutHook,
  withoutHooks,
  launcherLine,
  type HookSpec,
  type Launcher,
  type Settings,
} from "../capture/hook.js";
import { repoRoot } from "../git.js";

/** What `session hook install` needs. */
export interface HookOptions {
  /** The Claude Code settings file. Defaults to ~/.claude/settings.json. */
  settings?: string;
  /** What the hooks run. Defaults to this process's node and this package's cli.js. */
  launcher?: Launcher;
  /**
   * Whether to register the two hooks that record sessions nobody declared.
   * Defaults to on. `--passive=false` is the manual flow and nothing else:
   * `session start` opens every session, and the only hook is the one that
   * closes it.
   */
  passive?: boolean;
}

/** What happened, in the words the command prints. */
export interface HookResult {
  /** The settings file that was read, and written if anything changed. */
  file: string;
  /** What the file holds afterwards. Empty when the hooks were removed. */
  hooks: HookSpec[];
  /** False when the file already said what was asked for. */
  changed: boolean;
  action: "installed" | "removed";
  /** What the hooks now run in place of `session`. Absent when they were removed. */
  launcher?: Launcher;
  /** Commands in the file that ran a bare `session` before, and that still do. */
  bare: { before: number; after: number };
}

/**
 * The node running this and the `cli.js` beside this module, both absolute —
 * `import.meta.url` is already the real path, past any `bin` symlink. See
 * `Launcher` for why a hook cannot say `session`.
 */
export function currentLauncher(): Launcher {
  return { node: process.execPath, cli: fileURLToPath(new URL("../cli.js", import.meta.url)) };
}

function launcherOf(options: { launcher?: Launcher }): Launcher {
  return options.launcher ?? currentLauncher();
}

/**
 * Claude Code's user settings. The hook goes here rather than in the repo's
 * `.claude/settings.json`, which is checked in: a hook is one developer's
 * arrangement with their own machine, not something to commit on behalf of
 * everyone else working in the repo.
 */
export function settingsFile(options: HookOptions = {}): string {
  return options.settings ?? path.join(homedir(), ".claude", "settings.json");
}

async function readSettings(file: string, absentIsEmpty = false): Promise<Settings> {
  const text = await readSettingsText(file, absentIsEmpty);
  return text.trim() === "" ? {} : parseSettings(text, file);
}

/** The file's contents, or what to do about a machine that has none. */
async function readSettingsText(file: string, absentIsEmpty: boolean): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (absentIsEmpty) return "";
      throw new Error(
        `No Claude Code settings file at ${file}. Start Claude Code once so it ` +
          `writes one, or create the file with {} in it, then run session hook install again.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The settings as an object, or a refusal naming the file. Nothing is repaired
 * here: this is the one file `session` writes that it does not own, and
 * guessing at what somebody meant by it would be the way to lose their setup.
 */
function parseSettings(text: string, file: string): Settings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `The Claude Code settings file at ${file} is not valid JSON. ` +
        `Fix it by hand, then run session hook install again.`,
      { cause: error },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `The Claude Code settings file at ${file} is not a JSON object. ` +
        `Fix it by hand, then run session hook install again.`,
    );
  }
  return parsed as Settings;
}

/**
 * Replaces the file in one step. This is the only file `session` writes that
 * it does not own, and a half-written settings file would take the editor down
 * with it, so the new contents are staged beside it and renamed over the top.
 */
async function writeSettings(file: string, settings: Settings): Promise<void> {
  const staged = `${file}.session-tmp`;
  const mode = await stat(file).then((found) => found.mode & 0o777, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(staged, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  try {
    // Whatever the file was readable by, it still is.
    if (mode !== undefined) await chmod(staged, mode);
    await rename(staged, file);
  } catch (error) {
    await unlink(staged).catch(() => {});
    throw error;
  }
}

interface Target {
  file: string;
  /** True where a missing file is the normal case rather than a machine without the editor. */
  absentIsEmpty: boolean;
}

async function apply(
  target: Target,
  action: HookResult["action"],
  hooks: HookSpec[],
  launcher: Launcher | undefined,
  settled: (settings: Settings) => boolean,
  edit: (settings: Settings) => Settings,
): Promise<HookResult> {
  const { file } = target;
  const settings = await readSettings(file, target.absentIsEmpty);
  const changed = !settled(settings);
  const before = bareSessionCommands(settings);
  let after = before;

  // Nothing to say means nothing to write: an unchanged settings file keeps
  // its modification time, and no other tool watching it is disturbed.
  if (changed) {
    let next: Settings;
    try {
      next = edit(settings);
    } catch (error) {
      // The surgery does not know which file it is in, so the refusal says.
      throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
    }
    after = bareSessionCommands(next);
    await writeSettings(file, next);
  }

  return { file, hooks, changed, action, ...(launcher ? { launcher } : {}), bare: { before, after } };
}

const claude = (options: HookOptions): Target => ({ file: settingsFile(options), absentIsEmpty: false });

/**
 * Registers the hooks, leaving every other setting as it was.
 *
 * Passive capture is on unless it is turned off, and turning it off is a
 * statement about the file rather than an omission from it: the two hooks it
 * needs are taken back out if an earlier install put them there. Otherwise
 * `--passive=false` would be a flag that could not be changed its mind about.
 */
export function installHook(options: HookOptions = {}): Promise<HookResult> {
  return install(claude(options), options);
}

function install(target: Target, options: HookOptions): Promise<HookResult> {
  const wanted = wantedHooks(options.passive ?? true);
  const launcher = launcherOf(options);
  return apply(
    target,
    "installed",
    wanted,
    launcher,
    (settings) => hasHooks(settings, wanted, launcher),
    (settings) => withHooks(settings, wanted, launcher),
  );
}

/** Takes every hook back out, leaving every other setting as it was. */
export function uninstallHook(options: HookOptions = {}): Promise<HookResult> {
  return uninstall(claude(options));
}

function uninstall(target: Target): Promise<HookResult> {
  // Any launcher does: with nothing wanted, none is compared.
  return apply(target, "removed", [], undefined, (settings) => hasHooks(settings, [], currentLauncher()), withoutHooks);
}

/** What `session hook install --repo` needs: the repository it applies to. */
export interface RepoHookOptions {
  cwd?: string;
  /** What the check runs. Defaults to this process's node and this package's cli.js. */
  launcher?: Launcher;
}

/**
 * The repository's own, uncommitted Claude Code settings. Not the user's file,
 * because the check denies a supported write it cannot place in a repository —
 * registered there it would refuse edits in every directory on the machine.
 * Not the checked-in `.claude/settings.json`, because enforcing an agreement is
 * one developer's choice about their own sessions, the same as the other hooks.
 */
export async function repoSettingsFile(options: RepoHookOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  let root: string;
  try {
    root = await repoRoot(cwd);
  } catch (error) {
    throw new Error(
      "Not inside a git repository. Run session hook install --repo from the repository whose agreements it should check.",
      { cause: error },
    );
  }
  return path.join(root, ".claude", "settings.local.json");
}

/**
 * Registers the agreement check for this repository and nothing else. The
 * user-level hooks are neither read nor written, and every other setting in
 * the repository's file is carried through. The file is created if absent:
 * unlike the user's settings, a repository without one is the normal case.
 */
export async function installRepoHooks(options: RepoHookOptions = {}): Promise<HookResult> {
  const target: Target = { file: await repoSettingsFile(options), absentIsEmpty: true };
  const launcher = launcherOf(options);
  return apply(
    target,
    "installed",
    [CHECK_HOOK],
    launcher,
    (settings) => hasHook(settings, CHECK_HOOK, launcher),
    (settings) => withHook(settings, CHECK_HOOK, launcher),
  );
}

/**
 * Takes the agreement check back out of this repository's settings and
 * nothing else: other hooks in the file, every other setting, and the
 * user-level hooks all stay as they were. A repository with no file, or a
 * file without the check, is left alone — nothing is created to say so. A
 * file emptied by the removal stays as `{}`, since nothing records who made it.
 */
export async function uninstallRepoHooks(options: RepoHookOptions = {}): Promise<HookResult> {
  const target: Target = { file: await repoSettingsFile(options), absentIsEmpty: true };
  return apply(
    target,
    "removed",
    [],
    undefined,
    (settings) => !hasEntry(settings, CHECK_HOOK),
    (settings) => withoutHook(settings, CHECK_HOOK),
  );
}

/**
 * What the command prints: what it wrote, where it wrote it, and every hook
 * the file now holds. The hooks are listed rather than counted because which
 * ones are registered is the whole difference between the two arrangements —
 * one line is the manual flow, three is passive capture.
 */
export function formatHook(result: HookResult): string[] {
  const label =
    result.action === "installed"
      ? result.changed
        ? "wrote"
        : "already"
      : result.changed
        ? "removed"
        : "not set";

  const lines = [`  ${label.padEnd(7)}  ${result.file}`];
  if (result.hooks.length === 0) {
    lines.push("  hook     none registered");
  }
  for (const hook of result.hooks) {
    const event = hook.matcher === undefined ? hook.event : `${hook.event} (${hook.matcher})`;
    lines.push(`  hook     ${event} → ${hook.command}`);
  }
  if (result.launcher && result.hooks.length > 0) {
    // What `session` stands for above: the hooks name it by path, not by PATH.
    lines.push(`  via      ${launcherLine(result.launcher)}`);
  }
  const bare = bareNote(result);
  if (bare) lines.push(bare);
  return lines;
}

/**
 * One line when the file held a hook running a bare `session` — the command a
 * hook's `/bin/sh` may not find, so the hook fails with nothing to show for
 * it. Either install replaced them all, or some are not ones it registers and
 * are left for the developer.
 */
function bareNote(result: HookResult): string | undefined {
  const { before, after } = result.bare;
  if (result.action !== "installed" || before === 0) return undefined;
  const why = "which a hook's /bin/sh may not find";
  if (after > 0) {
    return `  note     ${after} other ${after === 1 ? "hook runs" : "hooks run"} a bare session, ${why}: edit by hand`;
  }
  return `  note     replaced ${before} ${before === 1 ? "hook" : "hooks"} that ran a bare session, ${why}`;
}
