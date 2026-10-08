import { plainPalette, type Palette } from "../render/palette.js";
import { AGENTS_WINDOWS, navigateAgents, renderAgentsUi, visibleAgentBlocks } from "../render/tui/agents.js";
import { navigateAgentSessions, renderAgentSessionsUi, selectAgentSessions, visibleAgentSessions } from "../render/tui/agent-sessions.js";
import type { StoreOptions } from "../store.js";
import { loadAgentsUi, type AgentsWorkspaceData } from "./agents-ui.js";
import { runUiBrowser, type UiBrowserResult, type UiTerminal } from "./ui.js";

export interface AgentsUiResult extends UiBrowserResult { sessionsByTool: Map<string, UiBrowserResult> }

/** Each browser gives up terminal ownership before its parent or child starts. */
export async function runAgentsUi(options: StoreOptions = {}, palette: Palette = plainPalette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout }, saved?: AgentsUiResult): Promise<AgentsUiResult> {
  const sessionsByTool = saved?.sessionsByTool ?? new Map<string, UiBrowserResult>();
  let overview: UiBrowserResult | undefined = saved;
  let data = await loadAgentsUi(overview?.days, options);
  const refresh = async (days?: number): Promise<AgentsWorkspaceData> => data = await loadAgentsUi(days, options);
  while (true) {
    overview = await runUiBrowser(data, refresh, palette, terminal, { ...overview, returnToHome: true,
      render: renderAgentsUi, select: visibleAgentBlocks, navigate: navigateAgents, windows: AGENTS_WINDOWS, openKey: "s" });
    if (overview.exitWorkspace || !overview.opened) return { ...overview, sessionsByTool };
    const tool = visibleAgentBlocks(data, overview.state)[overview.state.selected];
    if (!tool) continue;
    const days = overview.days;
    let updated: AgentsWorkspaceData | undefined; let childClosed = false;
    const refreshSessions = async () => {
      const next = await loadAgentsUi(days, options);
      if (!childClosed) updated = next;
      return selectAgentSessions(next, tool.agent);
    };
    const child = await runUiBrowser(selectAgentSessions(data, tool.agent), refreshSessions, palette, terminal,
      { ...sessionsByTool.get(tool.id), returnToHome: true, backLabel: "Tools", render: renderAgentSessionsUi,
        select: visibleAgentSessions, navigate: navigateAgentSessions });
    childClosed = true;
    sessionsByTool.set(tool.id, child);
    if (child.exitWorkspace) return { ...overview, exitWorkspace: true, sessionsByTool };
    if (updated) data = updated;
  }
}
