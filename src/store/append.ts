// Appending to the log, under a lock, with each line signed into the chain.
import { appendFile, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, GENESIS, lineHash, recordHash, type SignedBody } from "../chain.js";
import { fingerprint, loadOrCreateKeypair, signHash, type Keypair } from "../keys.js";
import {
  RECORD_VERSION,
  type LogRecord,
  type NewSession,
  type Session,
  type RecordFields,
  type SessionPatch,
  type StoreOptions,
} from "./record.js";
import { repoIdentity, resolveStoreFile, storeHome } from "./paths.js";
import {
  intentSourceFor,
  isComplete,
  keptIntent,
  readLog,
  readLogFile,
  readSessions,
  sessionFrom,
  type RawLog,
} from "./read.js";

// --- appending -----------------------------------------------------------

/** How long a lock is honoured before it is assumed to belong to a dead process. */
export const LOCK_STALE_MS = 10_000;

export const LOCK_POLL_MS = 25;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
export async function withLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await acquireLock(lock);
  try {
    return await action();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Blocks until the lock file is ours, or until waiting stops being reasonable. */
export async function acquireLock(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_STALE_MS * 2;
  for (;;) {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await waitForLock(lock, deadline);
    }
  }
}

/**
 * One turn of the wait: take over a lock a killed process left behind once it
 * is older than `LOCK_STALE_MS`, give up at the deadline, otherwise sleep.
 */
export async function waitForLock(lock: string, deadline: number): Promise<void> {
  const held = await stat(lock).catch(() => undefined);
  if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
    await rm(lock, { force: true });
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(
      `Timed out waiting for ${lock}. If no other session command is running, delete that file.`,
    );
  }
  await sleep(LOCK_POLL_MS);
}

/** The hash the next record must carry as its `prev`. */
export function nextPrev(log: RawLog): string {
  const last = log.lines.at(-1);
  return last ? lineHash(last.text) : GENESIS;
}

export async function writeRecord(id: string, set: RecordFields, options: StoreOptions): Promise<void> {
  const file = await resolveStoreFile(options);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  // Generated here on first use, then reused. Reading the key before taking
  // the lock keeps first-run key generation out of the critical section.
  const keypair = await loadOrCreateKeypair(storeHome(options));

  await withLock(file, async () => {
    const log = await readLog(options);
    const record = signRecord(id, set, nextPrev(log), keypair);

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

/** One record: hashed over its own body, signed over the hash. */
export function signRecord(
  id: string,
  set: RecordFields,
  prev: string,
  keypair: Keypair,
): LogRecord {
  const body: SignedBody = {
    v: RECORD_VERSION,
    id,
    at: new Date().toISOString(),
    set,
    prev,
    key: keypair.fingerprint,
  };
  const hash = recordHash(body);
  return { ...body, set, hash, sig: signHash(hash, keypair.privateKey) };
}


export function assertTimestamp(field: string, value: string): void {
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
  const intentSource = intentSourceFor(input);
  const repo = await repoIdentity(options.cwd ?? process.cwd());

  const session = sessionFrom(input, repo, intentSource);
  const { id, ...set } = session;
  await writeRecord(id, set, options);
  return session;
}

/**
 * Writes the intent of a passively opened session, once.
 *
 * The one path by which `intent` is ever written after the creating record,
 * and it exists because a session the hook opened has no intent to write at
 * the moment it opens: the developer has not typed anything yet. The first
 * prompt is those words, and they are recorded the moment they are said —
 * before the agent has run, before there is a result to shape them.
 *
 * Refuses everything else. A session that already has an intent keeps it,
 * whether it was declared or captured, so this can never become the edit that
 * invariant 1 exists to prevent.
 */
export async function captureIntent(
  id: string,
  intent: string,
  options: StoreOptions = {},
): Promise<Session> {
  const declared = intent.trim();
  if (declared === "") {
    throw new Error("no intent to capture: the prompt was empty");
  }

  const current = (await readSessions(options)).find((session) => session.id === id);
  if (!current) {
    throw new Error(`no session with id ${id}`);
  }
  if (current.intent !== null) {
    throw new Error("intent is written once and cannot be edited");
  }

  await writeRecord(id, { intent: declared }, options);
  return { ...current, intent: declared };
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
  refusePatch(patch);

  const current = (await readSessions(options)).find((session) => session.id === id);
  if (!current) {
    throw new Error(`no session with id ${id}`);
  }

  await writeRecord(id, patch, options);
  return { ...current, ...patch, id };
}

/**
 * The three fields decided before the work and never revised, and the two that
 * must still be timestamps. Refused here rather than at the call sites so a new
 * caller cannot quietly become the one that edits an intent.
 */
function refusePatch(patch: SessionPatch): void {
  if ("intent" in patch) {
    throw new Error(
      "intent is written once and cannot be edited. A passive session's first " +
        "prompt is written by captureIntent, which refuses an intent that is already there.",
    );
  }
  if ("intentSource" in patch) {
    throw new Error("intentSource is decided when the session opens and cannot be edited");
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
}
