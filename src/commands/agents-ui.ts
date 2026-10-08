import { agentBlocks } from "../agents-report.js";
import { knownAgents } from "../capture/index.js";
import { loadRates } from "../pricing.js";
import { repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";
import type { AgentsUiData } from "../render/tui/agents.js";
import type { AgentSessionsSource } from "../render/tui/agent-sessions.js";
import { agentSessions } from "./agents.js";
import { parseDays } from "./week.js";

export interface AgentsWorkspaceData extends AgentsUiData, AgentSessionsSource {}

/** Native agent membership and signed checks; browsing never settles or appends. */
export async function loadAgentsUi(days?: number, options: StoreOptions = {}): Promise<AgentsWorkspaceData> {
  if (days !== undefined) parseDays(String(days));
  const [recorded, rates, identity] = await Promise.all([
    agentSessions(days, options), loadRates(storeHome(options)), repoIdentity(options.cwd ?? process.cwd()),
  ]);
  const known = knownAgents();
  return {
    ...recorded, known,
    blocks: agentBlocks(recorded.sessions, { known, checks: recorded.checks, rates, now: Date.now() }),
    sessionCount: recorded.sessions.length, repo: repoName(identity), days,
  };
}
