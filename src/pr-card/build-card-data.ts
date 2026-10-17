// One card from the sessions matched to a PR, each figure read through the
// function every other view uses for it. Pure.
import { agentsOf, type AgentInfo } from "../agents.js";
import { resolveOutcome } from "../observe.js";
import type { RepoFacts } from "../outcome.js";
import { priceSession, wasMeasured, type RateTable } from "../pricing.js";
import { plural } from "../render/terminal/text.js";
import type { Session, SessionOutcome } from "../store.js";
import { isEmpty, isIntact, type ChainCheck } from "../verify.js";
import type { CardChain, CardCost, CardData, CardFile } from "./card-data.js";

/** What the card needs beyond the sessions themselves. */
export interface CardInputs {
  rates: RateTable;
  /** The adapters, as `knownAgents()` lists them. */
  agents: readonly AgentInfo[];
  /** Each session's log as `checkChain` walked it; a session with none here has no log to check. */
  chains: ReadonlyMap<string, ChainCheck>;
  /** The default branch as `factsFor` gathered it; absent, each session keeps its stored outcome. */
  facts?: RepoFacts;
  /** Nothing in the record says a merge was reverted, so the caller does. */
  reverted: boolean;
}

/** Chain states from weakest to strongest; the card shows the first any session's log is in. */
const WEAKEST_CHAIN: readonly CardChain[] = ["broken", "missing", "hashes-only", "verified"];

/** Outcomes from least landed to most; the card shows the first any session has. */
const LEAST_LANDED: readonly SessionOutcome[] = ["open", "abandoned", "merged"];

/** The card, or null when no session was matched: that is the no-record card, never an empty one. */
export function buildCardData(sessions: readonly Session[], inputs: CardInputs): CardData | null {
  if (sessions.length === 0) return null;
  const ordered = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return {
    askedFor: askedFor(ordered),
    agents: [...new Set(ordered.flatMap((session) => agentsOf(session.cost, inputs.agents)))].sort(),
    files: filesOf(ordered),
    cost: costOf(ordered, inputs.rates),
    chain: chainOf(ordered, inputs.chains),
    outcome: outcomeOf(ordered.map((session) => resolveOutcome(session, inputs.facts).outcome)),
    reverted: inputs.reverted,
  };
}

/** The recorded intents in start order; null when none was, never a stand-in. */
function askedFor(sessions: readonly Session[]): string | null {
  const intents = sessions.flatMap((session) => (session.intent === null ? [] : [session.intent]));
  return intents.length > 0 ? intents.join(" · ") : null;
}

/** Every changed path once, by path; outside scope if any session's record drifted onto it. */
function filesOf(sessions: readonly Session[]): CardFile[] {
  const files = new Map<string, boolean>();
  for (const session of sessions) {
    for (const path of session.reality) {
      files.set(path, (files.get(path) ?? true) && !session.drift.includes(path));
    }
  }
  return [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, inScope]) => ({ path, inScope }));
}

/**
 * The sum when every session has a figure; otherwise unpriced, counting no rate
 * and nothing captured apart, and naming each unrated model, since a rate for
 * that name is the fix.
 */
function costOf(sessions: readonly Session[], rates: RateTable): CardCost {
  let usd = 0;
  let unpriced = 0;
  let uncaptured = 0;
  const models = new Set<string>();
  for (const session of sessions) {
    const price = priceSession(session.cost, rates);
    if (!wasMeasured(session.cost)) {
      uncaptured += 1;
    } else if (!price.priced) {
      unpriced += 1;
      models.add(price.model);
    } else {
      usd += price.usd;
    }
  }
  if (unpriced === 0 && uncaptured === 0) return { priced: true, usd };
  const of = `of ${plural(sessions.length, "session", "sessions")}`;
  const reasons = [
    unpriced > 0 ? `${unpriced} ${of} unpriced (${[...models].join(", ")})` : "",
    uncaptured > 0 ? `${uncaptured} ${of} uncaptured` : "",
  ];
  return { priced: false, reason: reasons.filter((reason) => reason !== "").join(", ") };
}

/** The weakest state any session's log is in: verified only where every one was checked against its key. */
function chainOf(sessions: readonly Session[], chains: ReadonlyMap<string, ChainCheck>): CardChain {
  const states = sessions.map((session): CardChain => {
    const check = chains.get(session.id);
    if (check === undefined || isEmpty(check)) return "missing";
    if (!isIntact(check)) return "broken";
    return check.signaturesChecked ? "verified" : "hashes-only";
  });
  return WEAKEST_CHAIN.find((state) => states.includes(state)) ?? "verified";
}

/** The least-landed outcome among sessions that changed something; empty only when none did. */
function outcomeOf(outcomes: readonly SessionOutcome[]): SessionOutcome {
  return LEAST_LANDED.find((outcome) => outcomes.includes(outcome)) ?? "empty";
}
