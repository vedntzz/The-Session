// Walking past a torn write, and saying so. Pure; the rule is store/torn.ts.
import { lineHash } from "./chain.js";
import { acknowledgedTorn } from "./store/torn.js";
import type { RawLine } from "./store.js";
import type { ChainBreak, ChainCheck } from "./verify.js";

/**
 * True when the fault on `line` is a torn write the next record chains past.
 * The walk then goes on from it: the line is counted as torn, not as a record,
 * and the next record must still name it and hold up on its own. Anything else
 * that fails to parse stays a break.
 */
export function walkPastTorn(
  fault: Omit<ChainBreak, "line">, line: RawLine, next: RawLine | undefined,
  walk: { prev: string }, check: ChainCheck,
): boolean {
  if (fault.kind !== "corrupt" || !acknowledgedTorn(line.text, next?.text)) return false;
  check.torn = [...(check.torn ?? []), line.no];
  check.total -= 1;
  walk.prev = lineHash(line.text);
  return true;
}

/** The torn lines, for the `verify` report. What each write held is lost and not guessed at. */
export function describeTorn(torn: readonly number[]): string {
  const where = torn.length === 1 ? `line ${torn[0]}` : `lines ${torn.join(", ")}`;
  return `${where} cut short mid-write and never completed; the next record chains past it`;
}
