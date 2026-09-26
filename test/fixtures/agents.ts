// Sessions and inputs for the `session agents` report tests.
import { agentBlocks, type AgentInputs, type AgentRow } from "../../src/agents-report.js";
import { knownAgents } from "../../src/capture/index.js";
import type { RateTable } from "../../src/pricing.js";
import { zeroCost, type IntentSource, type Session, type SessionCost } from "../../src/store.js";
import type { WriteCheckEvent } from "../../src/write-check-event.js";

const NOW = Date.parse("2026-09-26T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const RATES: RateTable = new Map([["claude-x", { input: 1_000_000, cacheRead: 0, cacheCreation: 0, output: 0 }]]);
let next = 0;

/** A session the given adapters captured, at $1 by the rate above. */
export function session(agents: string[], fields: Partial<Session> = {}, cost: Partial<SessionCost> = {}): Session {
  next += 1;
  return {
    id: `s${next}`, repo: "remote:x", intent: "work", scope: [], baseline: [], reality: ["a.ts"], drift: [],
    outcome: "open", startedAt: new Date(NOW - 60 * DAY).toISOString(), endedAt: null, startCommit: "abc",
    cost: { ...zeroCost(), model: "claude-x", turns: 1, inputTokens: 1, apiCalls: 2, agents, ...cost }, ...fields,
  };
}

/** Merged `daysAgo`, with a 30-day check on record when `checked`. */
export function merged(agents: string[], daysAgo: number, checked = false, source: IntentSource = "declared"): Session {
  const observedAt = new Date(NOW - daysAgo * DAY).toISOString();
  const check = { window: 30 as const, observedAt, commit: "c", branch: "main", fates: { "a.ts": "survived" as const } };
  return session(agents, { outcome: "merged", intentSource: source,
    observations: [{ outcome: "merged", observedAt, commit: "c", branch: "main", source: "computed" }],
    ...(checked ? { survival: [check] } : {}) });
}

export const event = (agent: string, decision: WriteCheckEvent["decision"]): WriteCheckEvent =>
  ({ type: "write-check", n: 1, tool: "Edit", path: "a.ts", decision, reason: "r", agent });

export function inputs(checks: Record<string, WriteCheckEvent[]> = {}): AgentInputs {
  return { known: knownAgents(), checks: new Map(Object.entries(checks)), rates: RATES, now: NOW };
}

/** One agent's row for one source. */
export const row = (sessions: Session[], agent: string | null, source: IntentSource, with_ = inputs()): AgentRow =>
  agentBlocks(sessions, with_).find((block) => block.agent === agent)!.rows.find((r) => r.source === source)!;
