// The lock that serializes appends to one log file across processes.
//
// A bare O_APPEND write is atomic on its own, but a chained record is a read
// of the last line followed by a write, and two of those interleaved would
// give two records the same `prev` — a fork in the chain, indistinguishable
// from tampering, and permanent. So a lock that two processes both believe
// they hold is the one failure here that cannot be repaired afterwards.
//
// The lock is a file created with `wx`, holding who took it. It is taken over
// only when its owner is known to be gone: a dead pid on this host. Age alone
// is not that — a laptop that sleeps with a command half-way through wakes to
// find its lock "old" — so age decides only for a lock that names no owner
// (written before owners were recorded) or names another host's. Taking over
// moves the file aside and checks it is the same file that was judged stale,
// so a lock someone else has just taken is never the one deleted.
import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";

/** How long a lock with no living owner to ask about is honoured. */
export const LOCK_STALE_MS = 10_000;

export const LOCK_POLL_MS = 25;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Owner {
  pid: number;
  host: string;
}

/** Runs `action` holding the lock beside `file`, and always lets it go. */
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
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), token: randomUUID() }));
      } finally {
        await handle.close();
      }
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
 * One turn of the wait: take over a lock whose owner is gone, give up at the
 * deadline, otherwise sleep.
 */
export async function waitForLock(lock: string, deadline: number): Promise<void> {
  const held = await stat(lock).catch(() => undefined);
  if (held && isAbandoned(await ownerOf(lock), Date.now() - held.mtimeMs)) {
    await takeOver(lock, held.ino);
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(
      `Timed out waiting for ${lock}. If no other session command is running, delete that file.`,
    );
  }
  await sleep(LOCK_POLL_MS);
}

/** Who wrote the lock, or nothing where it does not say: an older lock, or one still being written. */
async function ownerOf(lock: string): Promise<Owner | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lock, "utf8"));
    const { pid, host } = (parsed ?? {}) as Record<string, unknown>;
    return Number.isInteger(pid) && typeof host === "string" ? { pid: pid as number, host } : undefined;
  } catch {
    return undefined;
  }
}

/** A dead owner on this host; otherwise, with no owner to ask, a lock older than the stale age. */
export function isAbandoned(owner: Owner | undefined, ageMs: number, here = hostname()): boolean {
  if (owner !== undefined && owner.host === here) return !isAlive(owner.pid);
  return ageMs > LOCK_STALE_MS;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // exists, but not ours to signal
  }
}

/**
 * Removes the lock judged abandoned, and only that one. It is renamed aside
 * first — atomic, so two waiters cannot both move it — and deleted if it is
 * the same file that was judged. If another waiter took over in between, what
 * was moved is that waiter's live lock: it is put back where nobody has taken
 * the name since, and the wait goes on.
 */
export async function takeOver(lock: string, judged: number): Promise<void> {
  const aside = `${lock}.${randomUUID()}.stale`;
  try {
    await rename(lock, aside);
  } catch {
    return; // gone already: somebody else took it over, or let it go
  }
  const moved = await stat(aside).catch(() => undefined);
  if (moved !== undefined && moved.ino !== judged) {
    await link(aside, lock).catch(() => undefined);
  }
  await rm(aside, { force: true });
}
