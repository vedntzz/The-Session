import { readSessions, type Session, type StoreOptions } from "../store.js";

/**
 * Picks the session `session show` should print.
 *
 * With no id, the most recent session that has stopped: an open session has no
 * reality to report yet, so showing it would be showing a blank. With an id,
 * that session — a full id, or as much of the front of one as is unambiguous,
 * since ids are UUIDs and nobody types those.
 */
export async function showSession(id?: string, options: StoreOptions = {}): Promise<Session> {
  const sessions = await readSessions(options);

  if (id !== undefined) {
    const wanted = id.trim();
    const exact = sessions.find((session) => session.id === wanted);
    if (exact) {
      return exact;
    }

    const matches = sessions.filter((session) => session.id.startsWith(wanted));
    if (matches.length > 1) {
      throw new Error(`${wanted} matches ${matches.length} sessions. Use more of the id.`);
    }
    if (matches.length === 0) {
      throw new Error(`No session with id ${wanted}. Run session show with no id for the last one.`);
    }
    return matches[0] as Session;
  }

  // `readSessions` sorts by start time, so the last closed session is the last
  // one to have started, not the last to have ended. In a repo where only one
  // session runs at a time those are the same session.
  const closed = sessions.filter((session) => session.endedAt !== null);
  const last = closed.at(-1);
  if (!last) {
    throw new Error("No closed sessions yet. Run session start, then session stop.");
  }
  return last;
}
