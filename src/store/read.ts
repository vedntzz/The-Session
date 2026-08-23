// Reading the log: lines to records, records folded into sessions.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasAttribution } from "../config.js";
import {
  RECORD_VERSION,
  zeroCost,
  type IntentSource,
  type LogRecord,
  type NewSession,
  type RecordFields,
  type Session,
  type SessionPatch,
  type StoreOptions,
} from "./record.js";
import { resolveStoreFile } from "./paths.js";

// --- log I/O -------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRecord(raw: string, file: string, lineNo: number): LogRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${file}:${lineNo}: corrupt JSON in session log`);
  }
  if (!isRecord(parsed) || typeof parsed["id"] !== "string" || !isRecord(parsed["set"])) {
    throw new Error(`${file}:${lineNo}: malformed session record`);
  }
  return recordFrom(parsed);
}

/**
 * The four chain fields stay undefined where they are absent, never "":
 * `canonicalJson` drops undefined, which is what lets a record written before
 * signing still hash exactly as it did.
 */
function recordFrom(parsed: Record<string, unknown>): LogRecord {
  const text = (key: string): string | undefined =>
    typeof parsed[key] === "string" ? (parsed[key] as string) : undefined;

  return {
    v: typeof parsed["v"] === "number" ? parsed["v"] : RECORD_VERSION,
    id: parsed["id"] as string,
    at: typeof parsed["at"] === "string" ? parsed["at"] : "",
    set: parsed["set"] as RecordFields,
    prev: text("prev"),
    key: text("key"),
    hash: text("hash"),
    sig: text("sig"),
  };
}

// --- the raw log ---------------------------------------------------------

/** One line of the file, kept as text because that is what the chain hashes. */
export interface RawLine {
  /** 1-based line number, counting blank lines, so messages can name it. */
  no: number;
  text: string;
}

export interface RawLog {
  file: string;
  /** Non-empty lines, in file order. */
  lines: RawLine[];
  /**
   * False when the file does not end in a newline, which means the last append
   * was cut short. Only ever the final line, since every write is one line.
   */
  complete: boolean;
}

export function splitLog(file: string, text: string): RawLog {
  const lines: RawLine[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() !== "") {
      lines.push({ no: index + 1, text: line });
    }
  }
  return { file, lines, complete: text === "" || text.endsWith("\n") };
}

/** Reads this repo's log. An absent file is an empty log, not an error. */
export async function readLog(options: StoreOptions = {}): Promise<RawLog> {
  const file = await resolveStoreFile(options);

  try {
    return splitLog(file, await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { file, lines: [], complete: true };
    }
    throw error;
  }
}

/**
 * Reads a log file by name — one that arrived from somewhere else, rather than
 * this repo's own. A missing file is an error here: the caller named it, so
 * reporting an empty log intact would answer a question nobody asked.
 */
export async function readLogFile(file: string): Promise<RawLog> {
  const resolved = path.resolve(file);

  try {
    return splitLog(resolved, await readFile(resolved, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No log file at ${resolved}.`, { cause: error });
    }
    throw error;
  }
}

/**
 * Where the intent came from, decided as the session opens and fixed there.
 *
 * A session whose intent is null is one nobody declared: it was opened by the
 * hook and is waiting for its first prompt. Recording that as `declared` would
 * be a claim that somebody typed it.
 */
export function intentSourceFor(input: NewSession): IntentSource {
  const source = input.intentSource ?? (input.intent === null ? "captured" : "declared");
  if (input.intent === null && source !== "captured") {
    throw new Error("a session with no intent yet is a captured one, not a declared one");
  }
  return source;
}

/** The record as it goes on disk, with every optional field defaulted. */
export function sessionFrom(input: NewSession, repo: string, intentSource: IntentSource): Session {
  return {
    id: input.id ?? randomUUID(),
    repo,
    intent: input.intent,
    intentSource,
    scope: input.scope ?? [],
    baseline: input.baseline ?? [],
    reality: input.reality ?? [],
    drift: input.drift ?? [],
    cost: input.cost ?? zeroCost(),
    outcome: input.outcome ?? "open",
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    startCommit: input.startCommit,
    // Only when there is one: an absent field and a field holding nothing say
    // the same thing, and the shorter line is the one worth writing.
    ...(input.attribution && hasAttribution(input.attribution)
      ? { attribution: input.attribution }
      : {}),
  };
}

/**
 * Reads the log and folds patch records into current session state, sorted by
 * start time ascending. Returns an empty array when no log exists yet.
 *
 * A truncated final line is tolerated (an interrupted append); corruption
 * anywhere earlier throws, since that is real data loss rather than a partial
 * write.
 */
export async function readSessions(options: StoreOptions = {}): Promise<Session[]> {
  const { file, lines, complete } = await readLog(options);

  const sessions = new Map<string, Session>();
  const order = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    let record: LogRecord;
    try {
      record = parseRecord(line.text, file, line.no);
    } catch (error) {
      if (index === lines.length - 1 && !complete) {
        break; // interrupted append; the rest of the log is intact
      }
      throw error;
    }
    foldRecord(record, sessions, order);
  }

  return [...sessions.values()].sort(byStartedAt(order));
}

/** Folds one patch onto the session it belongs to, in place. */
export function foldRecord(
  record: LogRecord,
  sessions: Map<string, Session>,
  order: Map<string, number>,
): void {
  const existing = sessions.get(record.id);
  const merged: Partial<Session> = { ...existing, ...record.set, ...keptIntent(existing, record) };
  if (!isComplete(merged)) {
    // A patch whose creating record is missing: nothing to anchor it to.
    return;
  }
  if (!existing) {
    order.set(record.id, order.size);
  }
  sessions.set(record.id, { ...merged, id: record.id });
}

/** Start time, ties broken by where the log first mentioned each session. */
export function byStartedAt(order: ReadonlyMap<string, number>): (a: Session, b: Session) => number {
  return (a, b) => {
    const delta = Date.parse(a.startedAt) - Date.parse(b.startedAt);
    return delta !== 0 ? delta : (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  };
}

/**
 * The session still running, i.e. the one that has not stopped. Note this is
 * not `outcome`: a stopped session stays `open` until it merges or is
 * abandoned. If several are running (parallel checkouts, a missed `stop`),
 * the most recently started wins.
 */
export async function getOpenSession(options: StoreOptions = {}): Promise<Session | undefined> {
  const open = (await readSessions(options)).filter((session) => session.endedAt === null);
  return open.at(-1);
}

/**
 * Enforces write-once on `intent` while folding.
 *
 * A passive session's intent arrives in a second record — the first prompt —
 * so the fold cannot simply refuse every later `intent`. What it refuses is a
 * later one on top of an intent that is already there: the first words written
 * are the ones that stand, whatever any subsequent record says.
 *
 * `captureIntent` checks the same thing before it writes, and that check is
 * the one that produces an error somebody can read. This is the backstop, and
 * it is here rather than only there because immutability that lives in the
 * writer is a convention, while immutability in the reader is a property of
 * the log: a record appended by hand cannot rewrite an intent either.
 */
export function keptIntent(
  existing: Partial<Session> | undefined,
  record: LogRecord,
): { intent?: string | null } {
  if (!existing || existing.intent == null || record.set.intent === undefined) {
    return {};
  }
  return { intent: existing.intent };
}

/**
 * True once the folded fields amount to a whole session. Only a creating
 * record carries all of them, so this is what distinguishes a session from a
 * patch left dangling by a missing first record.
 */
export function isComplete(value: Partial<Session>): value is Omit<Session, "id"> {
  const required: readonly (keyof Omit<Session, "id">)[] = [
    "repo",
    "intent",
    "scope",
    "baseline",
    "reality",
    "drift",
    "cost",
    "outcome",
    "startedAt",
    "endedAt",
    "startCommit",
  ];
  // `endedAt` is legitimately null while open, so presence is the test.
  return required.every((key) => value[key] !== undefined);
}
