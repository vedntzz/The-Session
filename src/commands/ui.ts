import { emitKeypressEvents } from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { knownAgents } from "../capture/index.js";
import { loadRates } from "../pricing.js";
import { readSessions, repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";
import { withOutcomes } from "../observe.js";
import { screenControl, plainPalette, plainUiTheme, uiThemeFor, type Palette, type UiTheme } from "../render/palette.js";
import { renderUi, type UiData } from "../render/tui/screen.js";
import { canReturnHome, initialState, navigate, visibleSessions, type UiKey, type UiState } from "../render/tui/state.js";
import { paintUiLine } from "../render/tui/chrome.js";
import { fit, fold } from "../render/tui/text.js";
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
export interface UiBrowserData { days?: number }
export type UiBrowserRenderer<Data> = (data: Data, state: UiState, columns: number, rows: number,
  palette?: Palette, notice?: string, theme?: UiTheme, returnToHome?: boolean) => ReturnType<typeof renderUi>;
export interface UiBrowserAction<Data = UiData> {
  key: string; label: string;
  input?: { label: string; initial?: () => string };
  run: (data: Data, state: UiState, value?: string, signal?: AbortSignal) => Promise<string>;
}
export interface UiBrowserOptions<Data = UiData> {
  returnToHome?: boolean; state?: UiState; selectedSessionId?: string;
  render?: UiBrowserRenderer<Data>;
  select?: (data: Data, state: UiState) => readonly { id: string }[];
  navigate?: typeof navigate;
  windows?: readonly (number | undefined)[];
  actions?: readonly UiBrowserAction<Data>[];
  canReturnHome?: typeof canReturnHome;
  refreshNotice?: string;
  openKey?: string;
  backLabel?: string;
}
export interface UiBrowserResult { state: UiState; selectedSessionId?: string; days?: number; exitWorkspace: boolean; opened?: true }

export function requireTerminal(terminal: UiTerminal): void {
  if (!terminal.input.isTTY || !terminal.output.isTTY || process.env["TERM"] === "dumb") {
    throw new Error("session ui needs an interactive terminal. Run session week for printable output.");
  }
}

/** Recorded history supplies its own renderer and selection to the shared owner. */
export function runUi(initial: UiData, refresh: (days?: number) => Promise<UiData>, palette: Palette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout }, options: UiBrowserOptions = {}): Promise<UiBrowserResult> {
  return runUiBrowser(initial, refresh, palette, terminal, { ...options, render: options.render ?? renderUi,
    select: options.select ?? ((data, state) => visibleSessions(data.sessions, state)) });
}

/** Terminal ownership is independent of whether rows are signed records or transcripts. */
export async function runUiBrowser<Data extends UiBrowserData>(initial: Data, refresh: (days?: number) => Promise<Data>,
  palette: Palette, terminal: UiTerminal,
  options: UiBrowserOptions<Data> & { render: UiBrowserRenderer<Data>; select: NonNullable<UiBrowserOptions<Data>["select"]> },
): Promise<UiBrowserResult> {
  requireTerminal(terminal);
  const { input, output } = terminal;
  const theme = palette === plainPalette ? plainUiTheme : uiThemeFor({ isTTY: output.isTTY });
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing === true;
  let data = initial;
  let state = { ...(options.state ?? initialState()) };
  const rows = options.select(data, state);
  if (options.selectedSessionId) state.selected = rows.findIndex(session => session.id === options.selectedSessionId);
  state.selected = Math.max(0, Math.min(rows.length - 1, state.selected));
  let maxScroll = 0;
  let notice = "";
  let refreshing = false;
  let acting = false;
  let closed = false;
  let pasting = false;
  let editing: { action: UiBrowserAction<Data>; value: string } | undefined;
  const pending = new AbortController();
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const result = (exitWorkspace: boolean, opened = false): UiBrowserResult => ({ state: { ...state },
    selectedSessionId: options.select(data, state)[state.selected]?.id, days: data.days, exitWorkspace,
    ...(opened ? { opened: true as const } : {}) });
  if (input.readableEnded || input.destroyed || output.destroyed) return result(true);

  return new Promise<UiBrowserResult>((resolve, reject) => {
    const draw = (): void => {
      if (closed) return;
      const frame = options.render(data, state, output.columns || 80, output.rows || 24, palette, notice, theme, options.returnToHome);
      maxScroll = frame.maxScroll;
      if (editing && (output.columns || 80) >= 60 && (output.rows || 24) >= 20) {
        const width = (output.columns || 80) - 5;
        const prompt = [editing.action.input!.label,
          `> ${fold(editing.value + "▌", width - 2).at(-1)!}`,
          "Enter Apply · Esc Cancel · Ctrl-U Clear · Ctrl-C Exit"];
        frame.lines.splice(-3, 3, ...prompt.map(text => paintUiLine({ text: fit(text, width), role: "focus" },
          { width, left: 2, terminalWidth: (output.columns || 80) - 1 }, theme)));
      }
      output.write(theme.background + screenControl.paint + frame.lines.join("\r\n"));
    };
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      pending.abort();
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
    const finish = (exitWorkspace = !options.returnToHome, opened = false): void => { try { cleanup(); resolve(result(exitWorkspace, opened)); } catch (error) { reject(error); } };
    const end = (): void => finish(true);
    const fail = (error: unknown): void => { try { cleanup(); } catch { /* Preserve the original failure. */ } reject(error); };
    const cancel = (code: number): void => { process.exitCode = code; end(); };
    const interrupt = (): void => cancel(130);
    const terminate = (): void => cancel(143);
    const hangup = (): void => cancel(129);
    const repaint = (): void => { try { draw(); } catch (error) { fail(error); } };
    const perform = async (action: UiBrowserAction<Data>, value?: string): Promise<void> => {
      acting = true;
      notice = `${action.label}…`;
      repaint();
      if (closed) { acting = false; return; }
      try {
        const message = await action.run(data, { ...state }, value, pending.signal);
        if (!closed) notice = message;
      } catch (error) {
        notice = `${action.label} failed: ${error instanceof Error ? error.message : String(error)} ${action.key} retries.`;
      } finally {
        acting = false;
        if (!closed) state.scroll = 0;
        repaint();
      }
    };
    const reload = async (days: number | undefined): Promise<void> => {
      refreshing = true;
      notice = options.refreshNotice ?? "Refreshing records and Git outcomes…";
      repaint();
      const id = options.select(data, state)[state.selected]?.id;
      try {
        const updated = await refresh(days);
        if (closed) return;
        data = updated;
        state.selected = Math.max(0, options.select(data, state).findIndex((session) => session.id === id));
        state.scroll = 0;
        notice = `Refreshed. r refresh · q ${options.backLabel ?? (options.returnToHome ? "Home" : "quit")}`;
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
        if (key.ctrl && key.name === "c") { interrupt(); return; }
        if (key.sequence === "\u001b[200~") { pasting = true; return; }
        if (pasting) {
          if (key.sequence === "\u001b[201~") pasting = false;
          else if (editing && key.sequence && !/[\u0000-\u001f\u007f-\u009f]/u.test(key.sequence)) {
            editing.value += key.sequence; draw();
          }
          return;
        }
        const tooSmall = (output.columns || 80) < 60 || (output.rows || 24) < 20;
        if (editing && !tooSmall) {
          if (key.name === "escape") { editing = undefined; notice = "Input cancelled; previous selection kept."; }
          else if (key.name === "return") {
            const { action, value } = editing; editing = undefined; void perform(action, value); return;
          } else if (key.ctrl && key.name === "u") editing.value = "";
          else if (key.name === "backspace") editing.value = editing.value.slice(0, [...graphemes.segment(editing.value)].at(-1)?.index ?? 0);
          else if (!key.ctrl && key.sequence && !/[\u0000-\u001f\u007f-\u009f]/u.test(key.sequence)) editing.value += key.sequence;
          draw(); return;
        }
        if (key.name === "q" && (!state.searching || tooSmall)) { finish(); return; }
        if (options.returnToHome && key.name === "escape" && (tooSmall || (options.canReturnHome ?? canReturnHome)(state))) { finish(); return; }
        if (tooSmall) return;
        if (options.openKey && !state.searching && !state.help && !key.ctrl && key.name === options.openKey) {
          if (!refreshing && !acting && options.select(data, state)[state.selected]) finish(false, true);
          return;
        }
        if (options.windows?.length && !state.searching && !state.help && !key.ctrl && key.name === "w") {
          const next = (options.windows.indexOf(data.days) + 1) % options.windows.length;
          if (!refreshing && !acting) void reload(options.windows[next]);
          return;
        }
        if (!state.searching && key.name === "r") {
          if (!refreshing && !acting) void reload(data.days);
          return;
        }
        const action = !state.searching && !state.help && !key.ctrl && options.actions?.find(action => action.key === key.name);
        if (action) {
          if (!refreshing && !acting) {
            if (action.input) { editing = { action, value: action.input.initial?.() ?? "" }; draw(); }
            else void perform(action);
          }
          return;
        }
        state = (options.navigate ?? navigate)(state, key, options.select(data, state).length, maxScroll);
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
