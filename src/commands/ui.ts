import { emitKeypressEvents } from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { knownAgents } from "../capture/index.js";
import { loadRates } from "../pricing.js";
import { readSessions, repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";
import { withOutcomes } from "../observe.js";
import { screenControl, plainPalette, plainUiTheme, uiThemeFor, type Palette } from "../render/palette.js";
import { renderUi, type UiData } from "../render/tui/screen.js";
import { canReturnHome, initialState, navigate, visibleSessions, type UiKey, type UiState } from "../render/tui/state.js";
import { weekSessions } from "./week.js";

/** Read-only: outcomes are resolved through the same path as `week`. */
export async function loadUi(days: number | undefined, options: StoreOptions = {}): Promise<UiData> {
  const records = days === undefined
    ? readSessions(options).then(sessions => withOutcomes(sessions, options.cwd ?? process.cwd()))
    : weekSessions(days, options);
  const [sessions, rates, identity] = await Promise.all([
    records, loadRates(storeHome(options)), repoIdentity(options.cwd ?? process.cwd()),
  ]);
  return { sessions: sessions.reverse(), rates, repo: repoName(identity), days, agents: knownAgents() };
}

export interface UiTerminal { input: ReadStream; output: WriteStream }
export interface UiBrowserAction {
  key: string; label: string;
  run: (data: UiData, state: UiState) => Promise<string>;
}
export interface UiBrowserOptions {
  returnToHome?: boolean; state?: UiState; selectedSessionId?: string;
  render?: typeof renderUi;
  navigate?: typeof navigate;
  windows?: readonly number[];
  actions?: readonly UiBrowserAction[];
  canReturnHome?: typeof canReturnHome;
  refreshNotice?: string;
}
export interface UiBrowserResult { state: UiState; selectedSessionId?: string; days?: number; exitWorkspace: boolean }

export function requireTerminal(terminal: UiTerminal): void {
  if (!terminal.input.isTTY || !terminal.output.isTTY || process.env["TERM"] === "dumb") {
    throw new Error("session ui needs an interactive terminal. Run session week for printable output.");
  }
}

/** Terminal ownership is scoped to this promise, including failure and signals. */
export async function runUi(
  initial: UiData,
  refresh: (days?: number) => Promise<UiData>,
  palette: Palette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout },
  options: UiBrowserOptions = {},
): Promise<UiBrowserResult> {
  requireTerminal(terminal);
  const { input, output } = terminal;
  const theme = palette === plainPalette ? plainUiTheme : uiThemeFor({ isTTY: output.isTTY });
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing === true;
  let data = initial;
  let state = { ...(options.state ?? initialState()) };
  const rows = visibleSessions(data.sessions, state);
  if (options.selectedSessionId) state.selected = rows.findIndex(session => session.id === options.selectedSessionId);
  state.selected = Math.max(0, Math.min(rows.length - 1, state.selected));
  let maxScroll = 0;
  let notice = "";
  let refreshing = false;
  let acting = false;
  let closed = false;
  let pasting = false;
  const result = (exitWorkspace: boolean): UiBrowserResult => ({ state: { ...state },
    selectedSessionId: visibleSessions(data.sessions, state)[state.selected]?.id, days: data.days, exitWorkspace });
  if (input.readableEnded || input.destroyed || output.destroyed) return result(true);

  return new Promise<UiBrowserResult>((resolve, reject) => {
    const draw = (): void => {
      if (closed) return;
      const frame = (options.render ?? renderUi)(data, state, output.columns || 80, output.rows || 24, palette, notice, theme, options.returnToHome);
      maxScroll = frame.maxScroll;
      output.write(theme.background + screenControl.paint + frame.lines.join("\r\n"));
    };
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      input.off("keypress", keypress);
      input.off("end", end);
      input.off("error", fail);
      output.off("error", fail);
      output.off("resize", repaint);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.off("SIGHUP", hangup);
      process.off("exit", cleanup);
      try { input.setRawMode(wasRaw); } finally {
        if (!wasFlowing) input.pause();
        if (!output.destroyed) output.write(screenControl.pasteOff + theme.reset + screenControl.leave);
      }
    };
    const finish = (exitWorkspace = !options.returnToHome): void => { try { cleanup(); resolve(result(exitWorkspace)); } catch (error) { reject(error); } };
    const end = (): void => finish(true);
    const fail = (error: unknown): void => { try { cleanup(); } catch { /* Preserve the original failure. */ } reject(error); };
    const cancel = (code: number): void => { process.exitCode = code; end(); };
    const interrupt = (): void => cancel(130);
    const terminate = (): void => cancel(143);
    const hangup = (): void => cancel(129);
    const repaint = (): void => { try { draw(); } catch (error) { fail(error); } };
    const perform = async (action: UiBrowserAction): Promise<void> => {
      acting = true;
      notice = `${action.label}…`;
      repaint();
      if (closed) { acting = false; return; }
      try {
        const message = await action.run(data, { ...state });
        if (!closed) notice = message;
      } catch (error) {
        notice = `${action.label} failed: ${error instanceof Error ? error.message : String(error)} ${action.key} retries.`;
      } finally {
        acting = false;
        if (!closed) state.scroll = 0;
        repaint();
      }
    };
    const reload = async (days = data.days): Promise<void> => {
      refreshing = true;
      notice = options.refreshNotice ?? "Refreshing records and Git outcomes…";
      repaint();
      const id = visibleSessions(data.sessions, state)[state.selected]?.id;
      try {
        const updated = await refresh(days);
        if (closed) return;
        data = updated;
        state.selected = Math.max(0, visibleSessions(data.sessions, state).findIndex((session) => session.id === id));
        state.scroll = 0;
        notice = `Refreshed. r refresh · q ${options.returnToHome ? "Home" : "quit"}`;
      } catch (error) {
        const retry = days === data.days ? "r retries" : "w retries the range; r refreshes the current range";
        notice = `Refresh failed: ${error instanceof Error ? error.message : String(error)}. ${retry}.`;
      } finally {
        refreshing = false;
        repaint();
      }
    };
    const keypress = (_text: string, key: UiKey = {}): void => {
      try {
        if (closed) return;
        if (key.sequence === "\u001b[200~") { pasting = true; return; }
        if (pasting) { if (key.sequence === "\u001b[201~") pasting = false; return; }
        if (key.ctrl && key.name === "c") { interrupt(); return; }
        const tooSmall = (output.columns || 80) < 60 || (output.rows || 24) < 20;
        if (key.name === "q" && (!state.searching || tooSmall)) { finish(); return; }
        if (options.returnToHome && key.name === "escape" && (tooSmall || (options.canReturnHome ?? canReturnHome)(state))) { finish(); return; }
        if (tooSmall) return;
        if (options.windows?.length && !state.searching && !state.help && !key.ctrl && key.name === "w") {
          const next = (options.windows.indexOf(data.days ?? options.windows[0]!) + 1) % options.windows.length;
          if (!refreshing && !acting) void reload(options.windows[next]);
          return;
        }
        if (!state.searching && key.name === "r") {
          if (!refreshing && !acting) void reload();
          return;
        }
        const action = !state.searching && !state.help && !key.ctrl && options.actions?.find(action => action.key === key.name);
        if (action) { if (!refreshing && !acting) void perform(action); return; }
        state = (options.navigate ?? navigate)(state, key, visibleSessions(data.sessions, state).length, maxScroll);
        draw();
      } catch (error) { fail(error); }
    };
    try {
      emitKeypressEvents(input);
      input.on("keypress", keypress);
      input.on("end", end);
      input.on("error", fail);
      output.on("error", fail);
      output.on("resize", repaint);
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
      process.on("SIGHUP", hangup);
      process.on("exit", cleanup);
      input.setRawMode(true);
      input.resume();
      output.write(screenControl.enter + screenControl.pasteOn);
      draw();
    } catch (error) { fail(error); }
  });
}
