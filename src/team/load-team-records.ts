// Every synced session record in a repo, read off refs/session/* into one flat list. Read-only.
import { foldLog, splitLog, type Session } from "../store.js";
import { LOG_ENTRY, localRefs, readLogAt } from "../sync.js";

/** A synced session, and the ref it was read from. */
export type TeamRecord = Readonly<Session & { sourceRef: string }>;

/** Per-person fields a stored record may carry; never passed on. */
const PERSONAL_FIELDS = ["name", "email", "author"];

/** Every ref under refs/session/, by name. Branches and tags are not listed. */
export async function listSessionRefs(repoDir: string): Promise<string[]> {
  return [...(await localRefs(repoDir)).keys()].sort();
}

/** Every session on every session ref, tagged with its ref, by start time. */
export async function loadTeamRecords(repoDir: string): Promise<readonly TeamRecord[]> {
  const refs = await listSessionRefs(repoDir);
  const perRef = await Promise.all(refs.map((ref) => recordsAt(repoDir, ref)));
  return perRef.flat().sort(byStartThenRef);
}

/** One ref's sessions; an unreadable ref is an error that names it. */
async function recordsAt(repoDir: string, ref: string): Promise<TeamRecord[]> {
  const text = await readLogAt(repoDir, ref);
  if (text === undefined) {
    throw new Error(`Could not read session records at ${ref}. Check it with git cat-file -p ${ref}:${LOG_ENTRY}.`);
  }
  return foldLog(splitLog(ref, text)).map((session) => ({ ...withoutPersonalFields(session), sourceRef: ref }));
}

function withoutPersonalFields(session: Session): Session {
  return Object.fromEntries(Object.entries(session).filter(([key]) => !PERSONAL_FIELDS.includes(key))) as unknown as Session;
}

function byStartThenRef(a: TeamRecord, b: TeamRecord): number {
  return Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.sourceRef.localeCompare(b.sourceRef) || a.id.localeCompare(b.id);
}
