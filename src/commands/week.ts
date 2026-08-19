import { execFile, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { classOf, type SessionClass } from "../classify.js";
import { withOutcomes } from "../observe.js";
import {
  intentSourceOf,
  readSessions,
  repoKey,
  type IntentSource,
  type Session,
  type SessionOutcome,
  type StoreOptions,
} from "../store.js";

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
  /** How text reaches the clipboard. Injected so tests touch nobody's. */
  copy?: (text: string) => Promise<void>;
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
 * Narrows the week to the work done for one client, one project, one kind of
 * change, or one end.
 */
export interface SessionFilter {
  client?: string;
  project?: string;
  /** Where the work went, as computed now — not as the record happens to say. */
  outcome?: SessionOutcome;
  /** What was being worked on. See `classify.ts`. */
  class?: SessionClass;
  /**
   * Where the intent came from: declared at `session start`, or captured from
   * the first prompt of a session the hook opened.
   *
   * Worth filtering on because the two are different evidence, and a week that
   * mixes them answers two questions at once. `--intent declared` is the work
   * somebody committed to in advance; `--intent captured` is everything that
   * happened without anyone saying so first, which is the pile most teams do
   * not know the size of.
   */
  intent?: IntentSource;
}

/** True when nothing is being filtered on. */
export function isEmptyFilter(filter: SessionFilter): boolean {
  return (
    filter.client === undefined &&
    filter.project === undefined &&
    filter.outcome === undefined &&
    filter.class === undefined &&
    filter.intent === undefined
  );
}

/**
 * Compares one attribution field.
 *
 * Case-insensitively, and ignoring surrounding space: the value was typed into
 * a shared file by one person and typed again on the command line by another,
 * and `--client acme` failing to find `Acme` would be a bug report every time.
 * Exact otherwise — a substring match would quietly fold two clients whose
 * names share a prefix into one invoice.
 */
function sameValue(recorded: string | undefined, wanted: string): boolean {
  return recorded !== undefined && recorded.trim().toLowerCase() === wanted.trim().toLowerCase();
}

/**
 * Whether a session belongs in a filtered week. A session with no attribution
 * matches no filter: it does not say who it was for, and guessing on its
 * behalf is how the wrong client gets billed.
 */
export function matchesFilter(session: Session, filter: SessionFilter): boolean {
  if (filter.client !== undefined && !sameValue(session.attribution?.client, filter.client)) {
    return false;
  }
  if (filter.project !== undefined && !sameValue(session.attribution?.project, filter.project)) {
    return false;
  }
  // Compared against `session.outcome`, which by the time the filter runs has
  // been replaced by the computed answer — see `withOutcomes`.
  if (filter.outcome !== undefined && session.outcome !== filter.outcome) {
    return false;
  }
  // `classOf` rather than the stored field, so a session recorded before the
  // class existed is matched on its paths rather than dropped from the week.
  if (filter.class !== undefined && classOf(session) !== filter.class) {
    return false;
  }
  // `intentSourceOf` rather than the stored field, for the same reason as
  // `classOf` above: a record written before passive capture existed carries
  // no field, and nothing but `session start` could have written it, so it is
  // declared. Reading the field raw would drop those from `--intent declared`,
  // which is the filter they most obviously belong to.
  if (filter.intent !== undefined && intentSourceOf(session) !== filter.intent) {
    return false;
  }
  return true;
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
  filter: SessionFilter = {},
): Promise<Session[]> {
  const sessions = await readSessions(options);
  const cutoff = Date.now() - days * DAY_MS;

  // The window first, so the repository is only asked about the sessions that
  // could appear. Outcomes next, because filtering on one means filtering on
  // what is true now. Then the rest of the filter, over the resolved rows.
  const inWindow = sessions.filter((session) => Date.parse(session.startedAt) >= cutoff);
  const resolved = await withOutcomes(inWindow, options.cwd ?? process.cwd());
  return resolved.filter((session) => matchesFilter(session, filter));
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

/**
 * Puts text on the system clipboard.
 *
 * Through the platform's own utility and its stdin, rather than a dependency:
 * the whole of what this needs is a pipe into one of three programs, and a
 * package that shells out to the same three would be a supply chain for it.
 *
 * A machine with no clipboard — a container, a bare ssh session — is the
 * common case for the last of these, so the failure says what to do instead
 * rather than reporting that a program is missing.
 */
export async function copyToClipboard(text: string, options: WeekOptions = {}): Promise<void> {
  if (options.copy) {
    return options.copy(text);
  }

  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["pbcopy", []]
      : process.platform === "win32"
        ? ["clip", []]
        : ["xclip", ["-selection", "clipboard"]];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    const failed = (cause: unknown): void => {
      reject(
        new Error(
          `Could not reach the clipboard with ${command}. Run without --copy and pipe the output instead.`,
          { cause },
        ),
      );
    };

    child.on("error", failed);
    child.on("close", (code) => (code === 0 ? resolve() : failed(`${command} exited ${code}`)));
    child.stdin.on("error", failed);
    child.stdin.end(text, "utf8");
  });
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
