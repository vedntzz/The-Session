import { withOutcomes } from "../observe.js";
import type { RepoFacts } from "../outcome.js";
import { readSessions, type Session, type StoreOptions } from "../store.js";

/**
 * Finds a session by id, or by as much of the front of one as is unambiguous —
 * ids are UUIDs and nobody types those. Shared by every command that takes one.
 */
export function findSession(sessions: readonly Session[], id: string): Session {
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

/**
 * Picks the session `session show` should print, with its outcome worked out
 * now rather than read off the record.
 *
 * With no id, the most recent session that has stopped: an open session has no
 * reality to report yet, so showing it would be showing a blank.
 */
export async function showSession(
  id?: string,
  options: StoreOptions = {},
  gathered?: RepoFacts,
): Promise<Session> {
  const wanted = await pickSession(id, options);
  // `gathered` is the daily sweep's, taken over every session — this one
  // included. See `withOutcomes`.
  const [resolved] = await withOutcomes([wanted], options.cwd ?? process.cwd(), gathered);
  return resolved as Session;
}

/**
 * The same choice of session, without asking the repository anything.
 *
 * For the commands that do not need an outcome: resolving one walks the
 * default branch's history for every path the session touched, which is the
 * most expensive thing this tool does and is wasted on a document about work
 * that has not landed yet. `session pr` is the caller — see `render/pr.ts`.
 */
export async function pickSession(id?: string, options: StoreOptions = {}): Promise<Session> {
  const sessions = await readSessions(options);
  return id !== undefined ? findSession(sessions, id) : lastClosed(sessions);
}

function lastClosed(sessions: readonly Session[]): Session {
  // `readSessions` sorts by start time, so the last closed session is the last
  // one to have started, not the last to have ended. In a repo where only one
  // session runs at a time those are the same session.
  const last = sessions.filter((session) => session.endedAt !== null).at(-1);
  if (!last) {
    throw new Error("No closed sessions yet. Run session start, then session stop.");
  }
  return last;
}
