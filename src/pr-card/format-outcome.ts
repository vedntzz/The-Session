// The card's outcome line. Pure.
import type { SessionOutcome } from "../store.js";

/** One label per outcome, so a new outcome is a compile error here until it has one. */
const OUTCOME_TEXT: Record<SessionOutcome, string> = {
  open: "still open",
  merged: "merged",
  abandoned: "didn't ship",
  empty: "no changes",
};

/** Where the work landed; reverted only means something once it merged. */
export function formatOutcome(outcome: SessionOutcome, reverted: boolean): string {
  const label = OUTCOME_TEXT[outcome];
  return outcome === "merged" && reverted ? `${label} · reverted` : label;
}
