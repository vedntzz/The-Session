import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bumped only if the on-disk record shape changes incompatibly. */
const RECORD_VERSION = 1;

export interface Session {
  id: string;
  /** ISO-8601 timestamp. */
  start: string;
  /** ISO-8601 timestamp. Absent means the session is still open. */
  end?: string;
  note?: string;
}

/** Fields `updateSession` may set. Values can be overwritten but not unset. */
export type SessionPatch = Partial<Omit<Session, "id">>;

export interface StoreOptions {
  /** Store root. Defaults to $SESSION_HOME, else ~/.session. */
  home?: string;
  /** Directory used to derive the repo key. Defaults to process.cwd(). */
  cwd?: string;
}

/**
 * One line of the log. Records are patches keyed by session id: the first
 * record for an id creates it, later records overlay fields onto it. Nothing
 * is ever rewritten in place, so a crash can only ever lose a trailing line.
 */
interface LogRecord {
  v: number;
  id: string;
  /** When the record was written, distinct from the session's own times. */
  at: string;
  set: SessionPatch;
}

// --- repo identity -------------------------------------------------------

/**
 * Normalizes a git remote so that equivalent forms of the same repository
 * collapse to one string: ssh/https, with or without credentials, with or
 * without a `.git` suffix.
 */
export function normalizeRemoteUrl(remote: string): string {
  let value = remote.trim();

  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (scheme) {
    try {
      const url = new URL(value);
      value = `${url.host}${url.pathname}`;
    } catch {
      value = value.slice(scheme[0].length);
    }
  } else {
    // scp-style: [user@]host:path
    const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(.+)$/.exec(value);
    if (scp) {
      value = `${scp[1]}/${scp[2]}`;
    }
  }

  value = value.replace(/\/+$/, "");
  if (value.toLowerCase().endsWith(".git")) {
    value = value.slice(0, -4);
  }
  return value.toLowerCase();
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
    const value = stdout.trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

/**
 * Identifies the repo this store belongs to, preferring the most stable
 * signal available: the origin remote, then the repository root, then the
 * directory itself. Using the repo root rather than the cwd means every
 * subdirectory of a repo shares one store.
 */
async function repoIdentity(cwd: string): Promise<string> {
  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  if (remote) {
    return `remote:${normalizeRemoteUrl(remote)}`;
  }

  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return `path:${path.resolve(root ?? cwd)}`;
}

/** Stable per-repo key. Same repo, same key, on any machine and any checkout. */
export async function repoKey(cwd: string = process.cwd()): Promise<string> {
  const identity = await repoIdentity(cwd);
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

function storeHome(options: StoreOptions = {}): string {
  return options.home ?? process.env["SESSION_HOME"] ?? path.join(homedir(), ".session");
}

/** Absolute path of the JSONL file backing the current repo. */
export async function resolveStoreFile(options: StoreOptions = {}): Promise<string> {
  const key = await repoKey(options.cwd ?? process.cwd());
  return path.join(storeHome(options), `${key}.jsonl`);
}

// --- log I/O -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(raw: string, file: string, lineNo: number): LogRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${file}:${lineNo}: corrupt JSON in session log`);
  }
  if (!isRecord(parsed) || typeof parsed["id"] !== "string" || !isRecord(parsed["set"])) {
    throw new Error(`${file}:${lineNo}: malformed session record`);
  }
  return {
    v: typeof parsed["v"] === "number" ? parsed["v"] : RECORD_VERSION,
    id: parsed["id"],
    at: typeof parsed["at"] === "string" ? parsed["at"] : "",
    set: parsed["set"] as SessionPatch,
  };
}

async function writeRecord(id: string, set: SessionPatch, options: StoreOptions): Promise<void> {
  const file = await resolveStoreFile(options);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  const record: LogRecord = { v: RECORD_VERSION, id, at: new Date().toISOString(), set };
  // A single write of one short line, opened O_APPEND: concurrent `session`
  // processes interleave whole lines rather than corrupting each other.
  await appendFile(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function assertTimestamp(field: string, value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 timestamp, got ${JSON.stringify(value)}`);
  }
}

// --- public API ----------------------------------------------------------

/**
 * Appends a new session. Returns the stored session, including the generated
 * id when the caller did not supply one.
 */
export async function appendSession(
  input: Omit<Session, "id"> & { id?: string },
  options: StoreOptions = {},
): Promise<Session> {
  assertTimestamp("start", input.start);
  if (input.end !== undefined) {
    assertTimestamp("end", input.end);
  }

  const session: Session = {
    id: input.id ?? randomUUID(),
    start: input.start,
    ...(input.end !== undefined ? { end: input.end } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };

  const { id, ...set } = session;
  await writeRecord(id, set, options);
  return session;
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
  const file = await resolveStoreFile(options);

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const complete = text.endsWith("\n");
  const lines = text.split("\n");
  const sessions = new Map<string, Session>();
  const order = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    const isFinalLine = index === lines.length - 1;
    let record: LogRecord;
    try {
      record = parseRecord(line, file, index + 1);
    } catch (error) {
      if (isFinalLine && !complete) {
        break; // interrupted append; the rest of the log is intact
      }
      throw error;
    }

    const existing = sessions.get(record.id);
    const merged: Partial<Session> = { ...existing, ...record.set };
    if (merged.start === undefined) {
      // A patch whose creating record is missing: nothing to anchor it to.
      continue;
    }
    if (!existing) {
      order.set(record.id, order.size);
    }
    sessions.set(record.id, { ...merged, id: record.id, start: merged.start });
  }

  return [...sessions.values()].sort((a, b) => {
    const delta = Date.parse(a.start) - Date.parse(b.start);
    return delta !== 0 ? delta : (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}

/**
 * The session still running, i.e. the one without an end. If several are open
 * (parallel checkouts, a missed `stop`), the most recently started wins.
 */
export async function getOpenSession(options: StoreOptions = {}): Promise<Session | undefined> {
  const open = (await readSessions(options)).filter((session) => session.end === undefined);
  return open.at(-1);
}

/**
 * Overlays `patch` onto an existing session by appending a patch record.
 * Throws if the id is unknown, so a typo cannot silently create a session
 * that consists only of an end time.
 */
export async function updateSession(
  id: string,
  patch: SessionPatch,
  options: StoreOptions = {},
): Promise<Session> {
  if (patch.start !== undefined) {
    assertTimestamp("start", patch.start);
  }
  if (patch.end !== undefined) {
    assertTimestamp("end", patch.end);
  }

  const current = (await readSessions(options)).find((session) => session.id === id);
  if (!current) {
    throw new Error(`no session with id ${id}`);
  }

  await writeRecord(id, patch, options);
  return { ...current, ...patch, id };
}
