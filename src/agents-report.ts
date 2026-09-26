// `session agents`: each agent's sessions, one row per intent source, never pooled. Pure.
import { agentsOf, countsCalls, type AgentInfo } from "./agents.js";
import { reportedOutcome } from "./outcome.js";
import { spendOf, type RateTable, type Spend } from "./pricing.js";
import { INTENT_SOURCES, intentSourceOf, type IntentSource, type Session } from "./store.js";
import { mergedAt, sample, type SurvivalSample } from "./survival.js";
import type { WriteCheckEvent } from "./write-check-event.js";

/** The survival window this view reports: 30 days past the merge. */
export const AGENT_WINDOW = 30 as const;

/** One agent's sessions from one intent source. */
export interface AgentRow {
  source: IntentSource;
  sessions: number;
  /** Of those, how many another agent also worked in: listed under each, never split. */
  mixed: number;
  merged: number;
  /** Only where somebody marked it: never inferred, so no merge rate is drawn from it. */
  abandoned: number;
  /** Not landed yet: never a failure. */
  open: number;
  empty: number;
  /** The 30-day window over merged sessions; pending is counted apart, never in the rate. */
  survival: SurvivalSample;
  /** Merged, but nothing records when, so no window can be placed. */
  undated: number;
  /** Asks and denials the agent's write check recorded; absent where it recorded no check. */
  writes?: { asked: number; denied: number };
  /** Absent where the agent counts no calls, or another agent's calls share the count. */
  calls?: number;
  spend: Spend;
}

/** One agent, or `null` for sessions no adapter captured anything for. */
export interface AgentBlock {
  agent: string | null;
  rows: AgentRow[];
}

/** What a row is computed from, beyond its sessions. */
export interface AgentInputs {
  known: readonly AgentInfo[];
  checks: ReadonlyMap<string, readonly WriteCheckEvent[]>;
  rates: RateTable;
  now: number;
}

/** Every known agent, then any other recorded name, then the uncaptured; each with every source. */
export function agentBlocks(sessions: readonly Session[], inputs: AgentInputs): AgentBlock[] {
  const agents = new Map(sessions.map((session) => [session, agentsOf(session.cost, inputs.known)]));
  const recorded = [...new Set([...agents.values()].flat())].sort();
  const names = [...new Set([...inputs.known.map((agent) => agent.name), ...recorded])];
  const blocks: AgentBlock[] = names.map((name) => blockOf(name, sessions.filter((s) => agents.get(s)!.includes(name)), inputs, agents));
  const none = sessions.filter((session) => agents.get(session)!.length === 0);
  return none.length > 0 ? [...blocks, blockOf(null, none, inputs, agents)] : blocks;
}

function blockOf(agent: string | null, members: readonly Session[], inputs: AgentInputs, agents: ReadonlyMap<Session, string[]>): AgentBlock {
  const rows = INTENT_SOURCES.map((source) =>
    rowOf(agent, members.filter((session) => intentSourceOf(session) === source), source, inputs, agents));
  return { agent, rows };
}

function rowOf(agent: string | null, sessions: readonly Session[], source: IntentSource, inputs: AgentInputs, agents: ReadonlyMap<Session, string[]>): AgentRow {
  const outcomes = sessions.map(reportedOutcome);
  const count = (outcome: string): number => outcomes.filter((value) => value === outcome).length;
  const [merged, abandoned] = [count("merged"), count("abandoned")];
  const landed = sessions.filter((session) => session.outcome === "merged");
  const writes = agent === null ? undefined : writesOf(agent, sessions, inputs.checks);
  const calls = agent === null ? undefined : callsFor(agent, sessions, inputs.known, agents);
  return {
    source, sessions: sessions.length, mixed: sessions.filter((session) => agents.get(session)!.length > 1).length,
    merged, abandoned, open: count("open"), empty: count("empty"),
    survival: sample(landed, AGENT_WINDOW, inputs.now),
    undated: landed.filter((session) => mergedAt(session) === undefined).length,
    ...(writes ? { writes } : {}), ...(calls !== undefined ? { calls } : {}),
    spend: spendOf(sessions, inputs.rates),
  };
}

/** The agent's own check events on these sessions; none at all is no check, not nought asked. */
function writesOf(agent: string, sessions: readonly Session[], checks: AgentInputs["checks"]): AgentRow["writes"] {
  const events = sessions.flatMap((session) => checks.get(session.id) ?? []).filter((event) => event.agent === agent);
  if (events.length === 0) return undefined;
  const decided = (decision: string): number => events.filter((event) => event.decision === decision).length;
  return { asked: decided("ask"), denied: decided("deny") };
}

/** The calls, where this agent counts them and no other counting agent shares a session. */
function callsFor(agent: string, sessions: readonly Session[], known: readonly AgentInfo[], agents: ReadonlyMap<Session, string[]>): number | undefined {
  if (!countsCalls(agent, known)) return undefined;
  const shared = sessions.some((session) => agents.get(session)!.some((other) => other !== agent && countsCalls(other, known)));
  return shared ? undefined : sessions.reduce((total, session) => total + session.cost.apiCalls, 0);
}
