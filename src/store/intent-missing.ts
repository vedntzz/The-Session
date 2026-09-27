// The other way a passive session's first prompt is recorded: as not captured.
import { writeRecord } from "./append.js";
import { readSessions } from "./read.js";
import type { Session, StoreOptions } from "./record.js";

/**
 * Records why a passive session's intent stays null, once.
 *
 * `captureIntent`'s counterpart for a first prompt that arrived without its
 * words: a paste the payload carried only the tag of. The words existed and
 * were not seen, so the intent stays null and says why — and stays null for
 * good. A later prompt is not the first thing asked, and writing it in would
 * put words on the record that were said second as the ones said first.
 *
 * Refuses a session that already has an intent or already has a reason, so
 * this can no more revise a declaration than `captureIntent` can.
 */
export async function recordIntentMissing(
  id: string,
  reason: NonNullable<Session["intentMissing"]>,
  options: StoreOptions = {},
): Promise<Session> {
  const current = (await readSessions(options)).find((session) => session.id === id);
  if (!current) {
    throw new Error(`no session with id ${id}`);
  }
  if (current.intent !== null || current.intentMissing !== undefined) {
    throw new Error("intent is written once and cannot be edited");
  }

  await writeRecord(id, { intentMissing: reason }, options);
  return { ...current, intentMissing: reason };
}
