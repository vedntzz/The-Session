// A line an interrupted append left behind, which a later append chained past.
//
// An append cut short leaves a line with no newline. The next append starts on
// a fresh line, so that damage stays on its own line — and it chains to it:
// its `prev` is the hash of the torn line exactly as it sits on disk, because
// that was the last line when it was written, under the lock. So a torn line
// is never a gap in the chain. It is a line that is not a record, which the
// record after it names.
//
// That naming is the whole test, and it is why this is not a way to hide an
// edit. A line someone overwrote with garbage is not named by the line after
// it, whose `prev` still holds the hash of what was there; a line inserted is
// not named either. Only the writer that appended next, holding the lock and
// the key, can have named it, and whether that record is itself sound is
// checked by the walk like any other.
import { lineHash } from "../chain.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `text` does not parse and `next` is a signed record whose `prev` is its hash. */
export function acknowledgedTorn(text: string, next: string | undefined): boolean {
  if (next === undefined) return false;
  try {
    JSON.parse(text);
    return false; // it parses: whatever is wrong with it, it is not a torn write
  } catch {
    // fall through: a torn write never parses
  }
  let record: unknown;
  try {
    record = JSON.parse(next);
  } catch {
    return false;
  }
  return isObject(record) && record["prev"] === lineHash(text) &&
    typeof record["hash"] === "string" && typeof record["sig"] === "string";
}
