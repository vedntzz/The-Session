import type { AgentInfo } from "../agents.js";
import type { SessionCost } from "../store.js";
import { mergeCosts, NO_COST, type Adapter, type CaptureWindow } from "./adapter.js";
import { CLAUDE_CODE_AGENT, createClaudeCodeAdapter } from "./adapters/claude-code.js";
import { CODEX_AGENT, createCodexAdapter } from "./adapters/codex.js";

export { NO_COST, type Adapter, type CaptureWindow } from "./adapter.js";

/** Every tool `session` knows how to read. Add new adapters here. */
export function defaultAdapters(): Adapter[] {
  return [createClaudeCodeAdapter(), createCodexAdapter()];
}

/** What the core may know of each adapter above: its name and whether it counts calls. */
export function knownAgents(): AgentInfo[] {
  return [CLAUDE_CODE_AGENT, CODEX_AGENT];
}

/**
 * Total cost across every available adapter. Capture is best-effort: a tool
 * whose transcripts are missing or unreadable contributes zeros rather than
 * failing the stop, since a session record is worth more than a perfect
 * token count.
 */
export async function captureCost(
  window: CaptureWindow,
  adapters: readonly Adapter[] = defaultAdapters(),
): Promise<SessionCost> {
  const costs = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return (await adapter.isAvailable()) ? await adapter.capture(window) : NO_COST;
      } catch {
        return NO_COST;
      }
    }),
  );
  // Which adapters found anything is written down, so a view never has to guess.
  const agents = adapters.filter((_, i) => costs[i]!.turns > 0 || costs[i]!.apiCalls > 0).map((a) => a.name);
  return { ...mergeCosts(costs), agents: [...new Set(agents)].sort() };
}
