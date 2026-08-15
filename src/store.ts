import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bumped only if the on-disk record shape changes incompatibly. */
const RECORD_VERSION = 1;

/**
 * What the session spent to get where it got. Token counters stay separate
 * because the four kinds bill at different rates; collapsing them to one
 * number throws away the information a price calculation needs.
 */
export interface SessionCost {
  /** Fresh input, billed at the full input rate. */
  inputTokens: number;
  /** Input served from cache, billed at a discount. */
  cacheReadTokens: number;
  /** Input written into cache, billed at a premium. */
  cacheCreationTokens: number;
  outputTokens: number;
  /** API calls observed, after streaming fragments are collapsed. */
  apiCalls: number;
  /** Calls that wrote no files: they cost tokens and changed nothing. */
  callsWithoutEdits: number;
  model: string;
}

/** Every token the session moved. For display only — never for pricing. */
export function totalTokens(cost: SessionCost): number {
  return cost.inputTokens + cost.cacheReadTokens + cost.cacheCreationTokens + cost.outputTokens;
}

/** A cost record with nothing counted yet. */
export function zeroCost(): SessionCost {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    apiCalls: 0,
    callsWithoutEdits: 0,
    model: "",
  };
}

/**
 * Where the session landed. Distinct from whether it is still running: a
 * session that has stopped is still `open` until it merges or is abandoned.
 */
export type SessionOutcome = "open" | "merged" | "abandoned";

export interface Session {
  id: string;
  /** Normalized repo identity, e.g. `remote:github.com/acme/tool`. */
  repo: string;
  /** What the session set out to do. Written once, never edited. */
  intent: string;
  /** The paths the developer declared. May be empty. */
  scope: string[];
  /**
   * Paths already modified when the session opened. Subtracted from `reality`
   * so a session is not blamed for work that was sitting there before it.
   */
  baseline: string[];
  /** The paths that actually changed, observed from git. */
  reality: string[];
  /** `reality` minus `scope` — recorded, never blocked. */
  drift: string[];
  cost: SessionCost;
  outcome: SessionOutcome;
  /** ISO-8601 timestamp. */
  startedAt: string;
  /** ISO-8601 timestamp. `null` means the session is still running. */
  endedAt: string | null;
  /** HEAD when the session opened, so its diff can be recovered later. */
  startCommit: string;
}

/** The `set` payload of a record. Creating records carry every field. */
type RecordFields = Partial<Omit<Session, "id">>;

/**
 * Fields `updateSession` may set. `intent` and `repo` are absent by design:
 * intent is written once at `start` so a declaration cannot be retrofitted to
 * match what happened, and repo is derived from where the store lives.
 */
export type SessionPatch = Omit<RecordFields, "intent" | "repo">;

/**
 * What a caller supplies at `session start`. Everything a session cannot know
 * yet — reality, drift, cost, where it ended up — is defaulted here and filled
 * in by later patches. `repo` is derived from the store's cwd, never passed.
 */
export type NewSession = Partial<Omit<Session, "id" | "repo">> &
  Pick<Session, "intent" | "startedAt" | "startCommit"> & { id?: string };

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
  set: RecordFields;
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
    set: parsed["set"] as RecordFields,
  };
}

async function writeRecord(id: string, set: RecordFields, options: StoreOptions): Promise<void> {
  const file = await resolveStoreFile(options);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  const record: LogRecord = { v: RECORD_VERSION, id, at: new Date().toISOString(), set };
  // A single write of one short line, opened O_APPEND: concurrent `session`
  // processes interleave whole lines rather than corrupting each other.
  await appendFile(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * True once the folded fields amount to a whole session. Only a creating
 * record carries all of them, so this is what distinguishes a session from a
 * patch left dangling by a missing first record.
 */
function isComplete(value: Partial<Session>): value is Omit<Session, "id"> {
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
  input: NewSession,
  options: StoreOptions = {},
): Promise<Session> {
  assertTimestamp("startedAt", input.startedAt);
  if (input.endedAt != null) {
    assertTimestamp("endedAt", input.endedAt);
  }

  const session: Session = {
    id: input.id ?? randomUUID(),
    repo: await repoIdentity(options.cwd ?? process.cwd()),
    intent: input.intent,
    scope: input.scope ?? [],
    baseline: input.baseline ?? [],
    reality: input.reality ?? [],
    drift: input.drift ?? [],
    cost: input.cost ?? zeroCost(),
    outcome: input.outcome ?? "open",
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    startCommit: input.startCommit,
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
    if (!isComplete(merged)) {
      // A patch whose creating record is missing: nothing to anchor it to.
      continue;
    }
    if (!existing) {
      order.set(record.id, order.size);
    }
    sessions.set(record.id, { ...merged, id: record.id });
  }

  return [...sessions.values()].sort((a, b) => {
    const delta = Date.parse(a.startedAt) - Date.parse(b.startedAt);
    return delta !== 0 ? delta : (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
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
 * Overlays `patch` onto an existing session by appending a patch record.
 * Throws if the id is unknown, so a typo cannot silently create a session
 * that consists only of an end time.
 */
export async function updateSession(
  id: string,
  patch: SessionPatch,
  options: StoreOptions = {},
): Promise<Session> {
  if ("intent" in patch) {
    throw new Error("intent is written once at start and cannot be edited");
  }
  if (patch.startedAt !== undefined) {
    assertTimestamp("startedAt", patch.startedAt);
  }
  if (patch.endedAt != null) {
    assertTimestamp("endedAt", patch.endedAt);
  }

  const current = (await readSessions(options)).find((session) => session.id === id);
  if (!current) {
    throw new Error(`no session with id ${id}`);
  }

  await writeRecord(id, patch, options);
  return { ...current, ...patch, id };
}
