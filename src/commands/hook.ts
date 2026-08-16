import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  hasHook,
  HOOK_COMMAND,
  HOOK_EVENT,
  withHook,
  withoutHook,
  type Settings,
} from "../capture/hook.js";

/** What `session hook install` needs. */
export interface HookOptions {
  /** The Claude Code settings file. Defaults to ~/.claude/settings.json. */
  settings?: string;
}

/** What happened, in the words the command prints. */
export interface HookResult {
  /** The settings file that was read, and written if anything changed. */
  file: string;
  event: string;
  command: string;
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
  let text: string;
  try {
    text = await readFile(file, "utf8");
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

  if (text.trim() === "") {
    return {};
  }

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
  wanted: (settings: Settings) => boolean,
  edit: (settings: Settings) => Settings,
): Promise<HookResult> {
  const file = settingsFile(options);
  const settings = await readSettings(file);
  const changed = !wanted(settings);

  // Nothing to say means nothing to write: an unchanged settings file keeps
  // its modification time, and no other tool watching it is disturbed.
  if (changed) {
    await writeSettings(file, edit(settings));
  }

  return { file, event: HOOK_EVENT, command: HOOK_COMMAND, changed, action };
}

/** Registers the hook, leaving every other setting as it was. */
export function installHook(options: HookOptions = {}): Promise<HookResult> {
  return apply("installed", options, hasHook, withHook);
}

/** Takes the hook back out, leaving every other setting as it was. */
export function uninstallHook(options: HookOptions = {}): Promise<HookResult> {
  return apply("removed", options, (settings) => !hasHook(settings), withoutHook);
}

/** What the command prints: what it wrote, and where it wrote it. */
export function formatHook(result: HookResult): [string, string] {
  const label =
    result.action === "installed"
      ? result.changed
        ? "wrote"
        : "already"
      : result.changed
        ? "removed"
        : "not set";

  return [
    `  ${label.padEnd(7)}  ${result.file}`,
    `  hook     ${result.event} → ${result.command}`,
  ];
}
