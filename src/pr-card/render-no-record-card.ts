// The PR card when no session was recorded: says so, and how to record one. Pure.
import { CARD_HEADING, CARD_MARKER } from "./render-pr-card.js";

/** The card for a PR with no session: marker, heading, the gap, the next step. */
export function renderNoRecordCard(): string {
  return [CARD_MARKER, CARD_HEADING, "", "No session recorded for this PR.", "",
    "Install hooks with `session hook install` to record future work."].join("\n");
}
