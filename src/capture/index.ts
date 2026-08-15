import type { SessionCost } from "../store.js";
import { mergeCosts, NO_COST, type Adapter, type CaptureWindow } from "./adapter.js";
import { createClaudeCodeAdapter } from "./adapters/claude-code.js";

export { NO_COST, type Adapter, type CaptureWindow } from "./adapter.js";

/** Every tool `session` knows how to read. Add new adapters here. */
export function defaultAdapters(): Adapter[] {
  return [createClaudeCodeAdapter()];
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
  return mergeCosts(costs);
}
