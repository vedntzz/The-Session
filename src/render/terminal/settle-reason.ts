import type { OutcomeVerdict } from "../../outcome.js";
import { plural } from "./text.js";

/** A short account of why a session was called what it was called. */
export function settlementReason(verdict: OutcomeVerdict): string {
  const parts: string[] = [];
  if (verdict.landed.length > 0) {
    parts.push(`${plural(verdict.landed.length, "file", "files")} in the branch`);
  }
  if (verdict.inFlight.length > 0) {
    parts.push(`${plural(verdict.inFlight.length, "file", "files")} still in the tree`);
  }
  if (verdict.lost.length > 0) {
    parts.push(`${plural(verdict.lost.length, "file", "files")} nowhere`);
  }
  return parts.length > 0 ? parts.join(", ") : "nothing was left behind";
}

