// An outcome's share of the sessions that changed code; "no changes" sits outside it. Pure.
import type { OutcomeSplit } from "./team-report.js";

/** Sessions whose outcome says code changed: every bucket but noChanges. */
export function changedSessions(outcomes: OutcomeSplit): number {
  return outcomes.shipped + outcomes.reverted + outcomes.neverMerged + outcomes.stillOpen;
}

/** `count` as a rounded percent of changed sessions; "n/a" when none changed, never 0%. */
export function shareOfChanged(count: number, outcomes: OutcomeSplit): string {
  const changed = changedSessions(outcomes);
  return changed === 0 ? "n/a" : `${Math.round((count / changed) * 100)}%`;
}
