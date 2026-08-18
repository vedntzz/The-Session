import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GENESIS, lineHash, recordHash, type SignedBody } from "./chain.js";
import type { SessionClass } from "./classify.js";
import { hasAttribution, type Attribution } from "./config.js";
import { loadOrCreateKeypair, signHash } from "./keys.js";
import type { Observation } from "./outcome.js";

const execFileAsync = promisify(execFile);

/** Bumped only if the on-disk record shape changes incompatibly. */
const RECORD_VERSION = 1;

/**
 * The four token counters, kept separate because the four kinds bill at
 * different rates. Collapsing them to one number throws away the information a
 * price calculation needs, so nothing in the record ever does.
 */
export interface TokenCounts {
  /** Fresh input, billed at the full input rate. */
  inputTokens: number;
  /** Input served from cache, billed at a discount. */
  cacheReadTokens: number;
  /** Input written into cache, billed at a premium. */
  cacheCreationTokens: number;
  outputTokens: number;
}

/** What the session spent to get where it got. */
export interface SessionCost extends TokenCounts {
  /** Developer turns: one per prompt, covering everything it set off. */
  turns: number;
  /** Turns that wrote no files — a whole prompt that produced nothing. */
  emptyTurns: number;
  /** API calls observed, after streaming fragments are collapsed. */
  apiCalls: number;
  /** Calls that wrote no files: they cost tokens and changed nothing. */
  callsWithoutEdits: number;
  model: string;
  /**
   * The same four counters, restricted to the turns that wrote no files.
   *
   * Counted at capture, where which turn a call belonged to is still known, so
   * that what the waste cost is a measurement. The alternative — taking the
   * session's total and multiplying by the share of turns that were empty —
   * would be a number nobody observed: empty turns are not average turns, and
   * the expensive ones are exactly the ones worth seeing.
   *
   * Absent on sessions captured before this existed. Nothing infers it.
   */
  emptyTurnTokens?: TokenCounts;
}

/** Every token the session moved. For display only — never for pricing. */
export function totalTokens(tokens: TokenCounts): number {
  return (
    tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens + tokens.outputTokens
  );
}

/** Four counters at nothing. */
export function zeroTokens(): TokenCounts {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
}

/** A cost record with nothing counted yet. */
export function zeroCost(): SessionCost {
  return {
    ...zeroTokens(),
    turns: 0,
    emptyTurns: 0,
    apiCalls: 0,
    callsWithoutEdits: 0,
    model: "",
    emptyTurnTokens: zeroTokens(),
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
  /**
   * What the session was mostly working on — schema, api, ui, test, config,
   * docs, build, other — derived from `reality` at `stop` by the path rules in
   * `classify.ts`. Absent on sessions stopped before it existed; readers
   * derive it from `reality` instead, which is the same computation.
   */
  class?: SessionClass;
  cost: SessionCost;
  outcome: SessionOutcome;
  /** ISO-8601 timestamp. */
  startedAt: string;
  /** ISO-8601 timestamp. `null` means the session is still running. */
  endedAt: string | null;
  /**
   * The blob id of each `reality` path as the session left it, captured at
   * `stop`. `null` means the session deleted the file.
   *
   * This is what makes an outcome decidable later. Whether the work merged is
   * a question about content — a squash merge keeps none of the original
   * commits — and without a record of what the session actually left there is
   * nothing to go looking for. A fact about what happened, like `reality`, not
   * a conclusion drawn from it. Absent on sessions stopped before it existed.
   */
  endState?: Record<string, string | null>;
  /**
   * Where the session was observed to have ended up, oldest first. Written by
   * `session settle` and `session mark`; never the basis for display, which is
   * computed afresh. See `outcome.ts`.
   */
  observations?: Observation[];
  /** HEAD when the session opened, so its diff can be recovered later. */
  startCommit: string;
  /**
   * Who the work was for, copied out of the repo's `.session.json` when the
   * session opened. Absent when the repo declares none.
   *
   * A copy, not a reference: a session records what the repo said at the time
   * it ran. Re-reading the file at display time would let a change of client
   * today rewrite who last quarter was billed to.
   */
  attribution?: Attribution;
}

/** The `set` payload of a record. Creating records carry every field. */
type RecordFields = Partial<Omit<Session, "id">>;

/**
 * Fields `updateSession` may set. Three are absent by design: intent is
 * written once at `start` so a declaration cannot be retrofitted to match what
 * happened, repo is derived from where the store lives, and attribution is
 * captured at start so that who was billed cannot be decided after the fact.
 */
export type SessionPatch = Omit<RecordFields, "intent" | "repo" | "attribution">;

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
export interface LogRecord {
  v: number;
  id: string;
  /** When the record was written, distinct from the session's own times. */
  at: string;
  set: RecordFields;
  /**
   * SHA-256 of the previous line as it sits on disk, `GENESIS` for the first.
   * Undefined on records written before the log was tamper-evident.
   */
  prev?: string;
  /** Fingerprint of the key that signed it, so a verifier knows which to want. */
  key?: string;
  /** SHA-256 of this record's body — see `chain.ts`. */
  hash?: string;
  /** Base64 Ed25519 signature over `hash`. */
  sig?: string;
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

/** The store root: where logs, and the signing key beside them, live. */
export function storeHome(options: StoreOptions = {}): string {
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
  const text = (key: string): string | undefined =>
    typeof parsed[key] === "string" ? (parsed[key] as string) : undefined;

  return {
    v: typeof parsed["v"] === "number" ? parsed["v"] : RECORD_VERSION,
    id: parsed["id"],
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

function splitLog(file: string, text: string): RawLog {
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

// --- appending -----------------------------------------------------------

/** How long a lock is honoured before it is assumed to belong to a dead process. */
const LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 25;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serializes appends to one log file across processes.
 *
 * A bare O_APPEND write is atomic on its own, but a chained record is a read
 * of the last line followed by a write, and two of those interleaved would
 * give two records the same `prev` — a fork in the chain, indistinguishable
 * from tampering. The lock is a file created with `wx`, which is atomic on
 * every filesystem this runs on; one left behind by a killed process is taken
 * over once it is older than `LOCK_STALE_MS`.
 */
async function withLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_STALE_MS * 2;

  for (;;) {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const held = await stat(lock).catch(() => undefined);
      if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${lock}. If no other session command is running, delete that file.`,
        );
      }
      await sleep(LOCK_POLL_MS);
    }
  }

  try {
    return await action();
  } finally {
    await rm(lock, { force: true });
  }
}

/** The hash the next record must carry as its `prev`. */
function nextPrev(log: RawLog): string {
  const last = log.lines.at(-1);
  return last ? lineHash(last.text) : GENESIS;
}

async function writeRecord(id: string, set: RecordFields, options: StoreOptions): Promise<void> {
  const file = await resolveStoreFile(options);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  // Generated here on first use, then reused. Reading the key before taking
  // the lock keeps first-run key generation out of the critical section.
  const keypair = await loadOrCreateKeypair(storeHome(options));

  await withLock(file, async () => {
    const log = await readLog(options);
    const body: SignedBody = {
      v: RECORD_VERSION,
      id,
      at: new Date().toISOString(),
      set,
      prev: nextPrev(log),
      key: keypair.fingerprint,
    };
    const hash = recordHash(body);
    const record: LogRecord = { ...body, set, hash, sig: signHash(hash, keypair.privateKey) };

    // A previous write cut short leaves a line with no newline on it. Starting
    // on a fresh line keeps that damage to the one line it happened on rather
    // than gluing this record onto the end of it.
    const lead = log.complete ? "" : "\n";
    // One short line, opened O_APPEND, under the lock: nothing here can leave
    // a record half-written that a reader could mistake for a whole one.
    await appendFile(file, `${lead}${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  });
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
    // Only when there is one: an absent field and a field holding nothing say
    // the same thing, and the shorter line is the one worth writing.
    ...(input.attribution && hasAttribution(input.attribution)
      ? { attribution: input.attribution }
      : {}),
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
  const { file, lines, complete } = await readLog(options);

  const sessions = new Map<string, Session>();
  const order = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    const isFinalLine = index === lines.length - 1;
    let record: LogRecord;
    try {
      record = parseRecord(line.text, file, line.no);
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
  if ("attribution" in patch) {
    throw new Error("attribution is captured at start and cannot be edited");
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
