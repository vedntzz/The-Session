// `session estimate`: reads the log, then hands it to the pure half.
//
// The shell. Every figure is worked out in `estimate/figures.ts` and printed by
// `render/estimate.ts`; what is left here is the one thing that touches a disk.
import { classOf, classifyIntent, classifyPaths } from "../classify.js";
import { withOutcomes } from "../observe.js";
import {
  intentSourceOf,
  readSessions,
  type IntentSource,
  type Session,
  type StoreOptions,
} from "../store.js";
import {
  chooseClass,
  comparable,
  groupFor,
  parseSince,
  type Estimate,
  type EstimateRequest,
} from "../estimate/figures.js";
import type { RateTable } from "../pricing.js";

export * from "../estimate/figures.js";
export { formatEstimate } from "../render/estimate.js";

/**
 * Past sessions of the class this intent reads as, and what they came to,
 * split by where their intent came from.
 *
 * Only sessions that stopped: an open one has no cost worth quoting and no end
 * to have merged. Outcomes are resolved for the matches alone — which class a
 * session was is a fact about its paths, so the repository need only be asked
 * about the ones that survive the filter.
 *
 * Sessions that changed no files come out before anything is counted. The
 * question this answers is what work like this has cost and how often it
 * landed, and a session that attempted nothing is not an instance of the work:
 * it would drag the median down, and it would sit in the merge rate's
 * denominator as a session that failed to merge when there was nothing to
 * merge. What it did cost is real, which is why it is still reported — as its
 * own count, in its own words.
 *
 * The split is on `intentSourceOf`, not the stored field, so a session
 * recorded before passive capture existed lands in `declared` rather than in
 * neither. See `EstimateGroup` for why the two are never added up.
 */
export async function estimateFor(
  request: EstimateRequest,
  rates: RateTable,
  options: StoreOptions = {},
): Promise<Estimate> {
  const choice = chooseClass(request);
  const sessions = await readSessions(options);
  const past = sessions.filter((session) => comparable(session, request, choice.class));

  const resolved = await withOutcomes(past, options.cwd ?? process.cwd());
  const bySource = (source: IntentSource): Session[] =>
    resolved.filter((session) => intentSourceOf(session) === source);

  return {
    intent: request.intent,
    class: choice.class,
    source: choice.source,
    ...(request.since === undefined
      ? {}
      : { since: new Date(request.since).toISOString().slice(0, 10) }),
    declared: groupFor("declared", bySource("declared"), rates),
    captured: groupFor("captured", bySource("captured"), rates),
  };
}
