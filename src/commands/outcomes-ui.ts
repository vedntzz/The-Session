import { factsFor, resolveOutcome } from "../observe.js";
import { plainPalette, type Palette } from "../render/palette.js";
import { renderOutcomesUi, type OutcomesUiData } from "../render/tui/outcomes.js";
import { visibleSessions } from "../render/tui/state.js";
import { readSessions, repoIdentity, repoName, type StoreOptions } from "../store.js";
import { formatSettle, settlementDecision, settleSessions } from "./settle.js";
import { runUiBrowser, type UiBrowserAction, type UiBrowserResult, type UiTerminal } from "./ui.js";

/** One current-repository gather; opening or refreshing never appends observations. */
export async function loadOutcomesUi(options: StoreOptions = {}): Promise<OutcomesUiData> {
  const cwd = options.cwd ?? process.cwd();
  const records = await readSessions(options);
  const [facts, identity] = await Promise.all([factsFor(records, cwd), repoIdentity(cwd)]);
  return { repo: repoName(identity), branch: facts?.branch, tip: facts?.tip,
    sessions: records.map(session => resolveOutcome(session, facts)).reverse(),
    decisions: new Map(records.map(session => [session.id, settlementDecision(session, facts)])) };
}

/** Confirmation covers all current-repo history. Native settle rereads records and facts. */
export function outcomesUiActions(options: StoreOptions = {}): readonly UiBrowserAction<OutcomesUiData>[] {
  return [{ key: "w", label: "Record outcomes",
    input: { label: "All sessions in this repo: type record to append outcomes" },
    async run(_data, _state, value, signal) {
      if (value !== "record") throw new Error("Nothing recorded. Type record exactly, or Esc to cancel.");
      signal?.throwIfAborted();
      let result;
      try { result = await settleSessions(options, undefined, signal); }
      catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}. Completed observations remain recorded; r reloads the log.`, { cause: error });
      }
      const message = formatSettle(result).map(line => line.trim()).join(" · ");
      try {
        const refreshed = await loadOutcomesUi(options);
        signal?.throwIfAborted();
        return { message, data: refreshed };
      } catch (error) {
        signal?.throwIfAborted();
        return `${message} · Display refresh failed: ${error instanceof Error ? error.message : String(error)}. r retries.`;
      }
    } }];
}

export async function runOutcomesUi(options: StoreOptions = {}, palette: Palette = plainPalette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout }, saved?: UiBrowserResult): Promise<UiBrowserResult> {
  const refresh = (): ReturnType<typeof loadOutcomesUi> => loadOutcomesUi(options);
  return runUiBrowser(await refresh(), refresh, palette, terminal, { ...saved, returnToHome: true,
    render: renderOutcomesUi, select: (data, state) => visibleSessions(data.sessions, state),
    refreshNotice: "Reading all recorded sessions and current Git evidence…", actions: outcomesUiActions(options) });
}
