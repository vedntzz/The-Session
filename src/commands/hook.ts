import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  hasHooks,
  wantedHooks,
  withHooks,
  withoutHooks,
  type HookSpec,
  type Settings,
} from "../capture/hook.js";

/** What `session hook install` needs. */
export interface HookOptions {
  /** The Claude Code settings file. Defaults to ~/.claude/settings.json. */
  settings?: string;
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

async function readSettings(file: string): Promise<Settings> {
  const text = await readSettingsText(file);
  return text.trim() === "" ? {} : parseSettings(text, file);
}

/** The file's contents, or what to do about a machine that has none. */
async function readSettingsText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
  await writeFile(staged, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  try {
    // Whatever the file was readable by, it still is.
    await chmod(staged, (await stat(file)).mode & 0o777);
    await rename(staged, file);
  } catch (error) {
    await unlink(staged).catch(() => {});
    throw error;
  }
}

async function apply(
  action: HookResult["action"],
  options: HookOptions,
  hooks: HookSpec[],
  settled: (settings: Settings) => boolean,
  edit: (settings: Settings) => Settings,
): Promise<HookResult> {
  const file = settingsFile(options);
  const settings = await readSettings(file);
  const changed = !settled(settings);

  // Nothing to say means nothing to write: an unchanged settings file keeps
  // its modification time, and no other tool watching it is disturbed.
  if (changed) {
    await writeSettings(file, edit(settings));
  }

  return { file, hooks, changed, action };
}

/**
 * Registers the hooks, leaving every other setting as it was.
 *
 * Passive capture is on unless it is turned off, and turning it off is a
 * statement about the file rather than an omission from it: the two hooks it
 * needs are taken back out if an earlier install put them there. Otherwise
 * `--passive=false` would be a flag that could not be changed its mind about.
 */
export function installHook(options: HookOptions = {}): Promise<HookResult> {
  const wanted = wantedHooks(options.passive ?? true);
  return apply(
    "installed",
    options,
    wanted,
    (settings) => hasHooks(settings, wanted),
    (settings) => withHooks(settings, wanted),
  );
}

/** Takes every hook back out, leaving every other setting as it was. */
export function uninstallHook(options: HookOptions = {}): Promise<HookResult> {
  return apply(
    "removed",
    options,
    [],
    (settings) => hasHooks(settings, []),
    withoutHooks,
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
    lines.push(`  hook     ${hook.event} → ${hook.command}`);
  }
  return lines;
}
