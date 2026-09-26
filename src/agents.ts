// Which coding agents captured a session, and whether its call count is known. Pure.
import type { SessionCost } from "./store.js";

/** What the core knows of an agent: its adapter's name and what that adapter reports. */
export interface AgentInfo {
  /** The adapter's stable name, as `cost.agents` records it. */
  readonly name: string;
  /** False where the adapter never counts API calls: its sessions' calls are unknown, not nought. */
  readonly reportsCalls: boolean;
  /** For records stopped before `cost.agents` existed: whether this adapter's own counters are on it. */
  recognises(cost: SessionCost): boolean;
}

/** The agents a session was captured by, sorted; the record's list, else each adapter's own counters. */
export function agentsOf(cost: SessionCost, known: readonly AgentInfo[]): string[] {
  const named = cost.agents ?? known.filter((agent) => agent.recognises(cost)).map((agent) => agent.name);
  return [...new Set(named)].sort();
}

/** True when an agent's calls were counted: only an adapter that reports calls counts them. */
export function countsCalls(name: string, known: readonly AgentInfo[]): boolean {
  return known.find((agent) => agent.name === name)?.reportsCalls ?? false;
}

/** The session's API calls, or undefined where an agent in it counts none. */
export function callsOf(cost: SessionCost, known: readonly AgentInfo[]): number | undefined {
  const agents = agentsOf(cost, known);
  return agents.every((name) => countsCalls(name, known)) ? cost.apiCalls : undefined;
}
