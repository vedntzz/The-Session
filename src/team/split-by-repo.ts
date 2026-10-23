// The team records that belong to this repo, and how many in the window belong to others. Pure.
import { startedWithin } from "./aggregate-team.js";
import type { TeamRecord } from "./load-team-records.js";
import type { TeamReport } from "./team-report.js";

/** This repo's records, and a count of in-window sessions from any other repo. */
export interface RepoSplit { own: readonly TeamRecord[]; otherRepoSessions: number }

/** Records whose repo is one of this repo's `identities`; the rest are counted, never classified here. */
export function splitByRepo(records: readonly TeamRecord[], identities: readonly string[], window: TeamReport["window"]): RepoSplit {
  const own = records.filter((record) => identities.includes(record.repo));
  const others = records.filter((record) => !identities.includes(record.repo) && startedWithin(record, window));
  return { own, otherRepoSessions: others.length };
}

/** The line saying what was left out, or nothing when nothing was. */
export function otherReposNote(otherRepoSessions: number): string | undefined {
  if (otherRepoSessions === 0) return undefined;
  return `${otherRepoSessions} sessions from other repos not included; run session team in those repos`;
}
