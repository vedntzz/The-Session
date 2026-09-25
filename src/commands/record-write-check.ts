// Writes what one write check answered to the signed chain. Bounded: the host
// is waiting, and a recorder that outlived the hook's timeout would turn the
// check's denial into a timed-out hook, which the host lets through. When the
// budget runs out or anything fails, there is no event — never a guessed one.
import { realpath } from "node:fs/promises";
import { repoRoot } from "../git.js";
import { readSessions, writeRecordFrom, type StoreOptions } from "../store.js";
import type { WriteCheckEvent } from "../write-check-event.js";
import { selectWriteSession } from "../write-session.js";
import { nextEventNumber, writeCheckEvents, type CheckProgress, type WriteCheckVerdict } from "../write-checks.js";

/** The recorder's own budget, after the check's. Both together stay inside the hook's timeout. */
export const RECORD_DEADLINE_MS = 3_000;

export async function recordWriteCheck(
  verdict: WriteCheckVerdict, progress: CheckProgress, agent: string,
  options: StoreOptions, budgetMs = RECORD_DEADLINE_MS,
): Promise<void> {
  if (!verdict.recorded) return;
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
  try {
    await Promise.race([record(verdict, progress, agent, options).catch(() => undefined), budget]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One record per event, all numbered by the first: the number is taken under
 * the lock from what is on disk, so no other event can hold it. A check that
 * never reached its session selects it here, as the check would have; none
 * open in this checkout, or one it could not choose, means nowhere to write.
 */
async function record(verdict: WriteCheckVerdict, progress: CheckProgress, agent: string, options: StoreOptions): Promise<void> {
  const session = progress.session === undefined ? await sessionHere(options) : progress.session;
  if (!session) return;
  let n: number | undefined;
  for (const event of writeCheckEvents(verdict, progress, agent)) {
    await writeRecordFrom({ ...options, cwd: session.checkout }, (log) => {
      n ??= nextEventNumber(log, session.id);
      const writeCheck: WriteCheckEvent = { ...event, n };
      return { id: session.id, set: { writeCheck } };
    });
  }
}

async function sessionHere(options: StoreOptions): Promise<CheckProgress["session"] | undefined> {
  const checkout = await realpath(await repoRoot(options.cwd ?? process.cwd()));
  const session = selectWriteSession(await readSessions({ ...options, cwd: checkout }), checkout);
  return session ? { id: session.id, checkout } : undefined;
}
