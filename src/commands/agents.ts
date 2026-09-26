// Gathers `session agents`: every session in the window with its outcome resolved, and its write checks.
import { withOutcomes } from "../observe.js";
import type { RepoFacts } from "../outcome.js";
import { foldLogs, relabel, sameRepoLogs, type Session, type StoreOptions } from "../store.js";
import type { WriteCheckEvent } from "../write-check-event.js";
import { checksBySession } from "../write-checks.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgentSessions {
  sessions: Session[];
  checks: Map<string, WriteCheckEvent[]>;
}

/** All recorded history, or the last `days`; outcomes are what the repository says now. */
export async function agentSessions(days: number | undefined, options: StoreOptions = {}, gathered?: RepoFacts): Promise<AgentSessions> {
  const { identity, logs } = await sameRepoLogs(options);
  const cutoff = days === undefined ? -Infinity : Date.now() - days * DAY_MS;
  const inWindow = relabel(foldLogs(logs), identity).filter((session) => Date.parse(session.startedAt) >= cutoff);
  const sessions = await withOutcomes(inWindow, options.cwd ?? process.cwd(), gathered);
  return { sessions, checks: checksBySession(logs) };
}
