// Which bucket of OutcomeSplit each team record lands in, by the rule the PR card uses.
import { resolveOutcome } from "../observe.js";
import type { RepoFacts } from "../outcome.js";
import type { Session, SessionOutcome } from "../store.js";
import type { TeamRecord } from "./load-team-records.js";
import type { OutcomeSplit } from "./team-report.js";

/** One bucket per outcome; a new outcome does not compile until it is mapped here. */
export const BUCKET_OF_OUTCOME: Readonly<Record<SessionOutcome, keyof OutcomeSplit>> = {
  merged: "shipped",
  abandoned: "neverMerged",
  open: "stillOpen",
  empty: "noChanges",
};

/** Paid-for work that did not stay in the branch. Open work is not finished, so never waste. */
const WASTE_BUCKETS: ReadonlySet<keyof OutcomeSplit> = new Set(["reverted", "neverMerged"]);

/** Nothing detects reverts yet, so no record is reverted. */
const NO_REVERT_DETECTION = false;

/** The bucket for one session, from what the repository says now. */
export function classifyOutcome(session: Session, facts: RepoFacts | undefined, reverted: boolean): keyof OutcomeSplit {
  const outcome = resolveOutcome(session, facts).outcome;
  return outcome === "merged" && reverted ? "reverted" : BUCKET_OF_OUTCOME[outcome];
}

/** True for a bucket that counts as spend that did not ship. */
export function isWaste(bucket: keyof OutcomeSplit): boolean {
  return WASTE_BUCKETS.has(bucket);
}

/** How many records land in each bucket. */
export function countOutcomes(records: readonly TeamRecord[], facts: RepoFacts | undefined): OutcomeSplit {
  const split: OutcomeSplit = { shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 };
  for (const record of records) split[classifyOutcome(record, facts, NO_REVERT_DETECTION)] += 1;
  return split;
}
