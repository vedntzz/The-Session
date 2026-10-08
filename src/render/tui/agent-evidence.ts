import { agentSessionsOf } from "../../agent-sessions.js";
import { agentsOf, callsOf, type AgentInfo } from "../../agents.js";
import { wasMeasured } from "../../pricing.js";
import type { Session } from "../../store.js";
import type { WriteCheckDecision, WriteCheckEvent } from "../../write-check-event.js";

const DECISIONS: Record<WriteCheckDecision, string> = {
  ask: "ask · approval requested",
  deny: "deny · check refused the write",
  silent: "silent · no objection; editor permissions still apply",
  "not-checked": "not-checked · check did not finish",
};

/** A transcription of membership and decisions, never proof that a write happened. */
export function agentEvidenceLines(session: Session, checks: readonly WriteCheckEvent[], known: readonly AgentInfo[]): string[] {
  const agents = agentsOf(session.cost, known);
  const calls = wasMeasured(session.cost) && agents.length ? callsOf(session.cost, known) : undefined;
  const lines = [`Coding tools: ${agents.length ? agents.join(" · ") : "no agent captured"}`,
    `Session API calls: ${calls ?? "not counted"}`];
  if (agents.length > 1) lines.push("Mixed session: membership is whole; usage is not split between tools.");
  const bindings = agentSessionsOf(session);
  lines.push("EDITOR SESSIONS", ...bindings.map(binding =>
    `${binding.id} · ${binding.agent ?? "tool not recorded"} · ${binding.live ? "live on record; no end recorded" : "ended"}`));
  if (!bindings.length) lines.push("No editor session IDs recorded; legacy capture uses the time window.");
  lines.push("WRITE CHECKS", "Recorded decisions, not completed writes. Signatures are not verified by this view.");
  if (!checks.length) lines.push("No write check recorded; asks and denials are unknown.");
  for (const check of checks) {
    const decision = Object.hasOwn(DECISIONS, check.decision) ? DECISIONS[check.decision] : "unrecognised decision";
    lines.push(`#${check.n} · ${check.agent} · ${decision}`,
      `Tool: ${check.tool ?? "not recorded"} · Path: ${check.path ?? "not resolved"}`, `Reason: ${check.reason}`);
  }
  return lines;
}
