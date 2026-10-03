// Capture for one session: by its agent sessions where the record names them,
// by time window where it does not (SES-2). Every adapter reads one agent
// session at a time, and the sessions' costs are added up.
import { agentSessionIds } from "../agent-sessions.js";
import type { Session, SessionCost } from "../store.js";
import { mergeCosts, type Adapter, type CaptureWindow, type FirstPrompt } from "./adapter.js";
import { captureCost, firstPromptIn } from "./index.js";

/**
 * What the session spent. Bound, where it names agent sessions: each one's
 * transcript and nobody else's, so a second agent in the same repo is not on
 * the bill. Otherwise the window, as every record before this was captured.
 * `capturedBy` says which, so a reader never has to guess.
 */
export async function captureFor(
  session: Pick<Session, "openedBy" | "agentEvents">, window: CaptureWindow, adapters?: readonly Adapter[],
): Promise<SessionCost> {
  const ids = agentSessionIds(session);
  if (ids.length === 0) return { ...(await captureCost(window, adapters)), capturedBy: "window" };
  const costs = await Promise.all(ids.map((id) => captureCost({ ...window, agentSessionId: id }, adapters)));
  const agents = [...new Set(costs.flatMap((cost) => cost.agents ?? []))].sort();
  return { ...mergeCosts(costs), agents, capturedBy: "agent-session" };
}

/** The first prompt typed in the window, from the session's own agents where it names them. */
export async function firstPromptFor(
  session: Pick<Session, "openedBy" | "agentEvents">, window: CaptureWindow, adapters?: readonly Adapter[],
): Promise<FirstPrompt | undefined> {
  const ids = agentSessionIds(session);
  if (ids.length === 0) return firstPromptIn(window, adapters);
  const found = await Promise.all(ids.map((id) => firstPromptIn({ ...window, agentSessionId: id }, adapters)));
  return found.filter((prompt) => prompt !== undefined).sort((a, b) => a.at - b.at)[0];
}
