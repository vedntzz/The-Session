import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readSessions, repoKey, type Session, type StoreOptions } from "../store.js";

const execFileAsync = promisify(execFile);

/** The window `session week` reports on when nobody says otherwise. */
export const DEFAULT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What `session week --open` needs, on top of where the store lives. */
export interface WeekOptions extends StoreOptions {
  /** Where the page is written. Defaults to the system temp directory. */
  tmp?: string;
  /** How the page reaches the desktop. Injected so tests open no browsers. */
  launch?: (file: string) => Promise<void>;
}

/**
 * Reads `--days`. Whole days only: a window of 2.5 days is a boundary nobody
 * can hold in their head, and it would make two runs an hour apart disagree
 * about which sessions belong to the week.
 */
export function parseDays(value?: string): number {
  if (value === undefined) {
    return DEFAULT_DAYS;
  }
  const days = Number(value.trim());
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--days takes a whole number of days, 1 or more. Got ${value}.`);
  }
  return days;
}

/**
 * The sessions that started inside the window, oldest first — a rolling one,
 * not calendar days, so the week means the same thing whenever it is run.
 *
 * A session still running is included: it is part of the week whether or not
 * it has been stopped, and its row says so.
 */
export async function weekSessions(
  days: number = DEFAULT_DAYS,
  options: StoreOptions = {},
): Promise<Session[]> {
  const sessions = await readSessions(options);
  const cutoff = Date.now() - days * DAY_MS;
  return sessions.filter((session) => Date.parse(session.startedAt) >= cutoff);
}

/**
 * Writes the page and returns where it went.
 *
 * One file per repo, rewritten each time rather than a fresh temp file per
 * run: reopening the week should not leave a trail of stale pages behind, and
 * a stale page is worse than no page. It is written 0600 because it holds the
 * same intents the store does, in a directory the whole machine can read.
 */
export async function writeWeekPage(html: string, options: WeekOptions = {}): Promise<string> {
  const key = await repoKey(options.cwd ?? process.cwd());
  const file = path.join(options.tmp ?? tmpdir(), `session-week-${key}.html`);
  await writeFile(file, html, { encoding: "utf8", mode: 0o600 });
  return file;
}

/** Hands the file to whatever the desktop uses to open one. */
export async function openInBrowser(file: string, options: WeekOptions = {}): Promise<void> {
  if (options.launch) {
    return options.launch(file);
  }

  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];

  try {
    await execFileAsync(command, args);
  } catch (error) {
    throw new Error(`Could not open a browser with ${command}. Open ${file} yourself.`, {
      cause: error,
    });
  }
}
