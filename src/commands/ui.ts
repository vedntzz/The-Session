import { emitKeypressEvents } from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { loadRates } from "../pricing.js";
import { repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";
import { screenControl, plainPalette, plainUiTheme, uiThemeFor, type Palette } from "../render/palette.js";
import { renderUi, type UiData } from "../render/tui/screen.js";
import { initialState, navigate, visibleSessions, type UiKey } from "../render/tui/state.js";
import { weekSessions } from "./week.js";

/** Read-only: outcomes are resolved through the same path as `week`. */
export async function loadUi(days: number, options: StoreOptions = {}): Promise<UiData> {
  const [sessions, rates, identity] = await Promise.all([
    weekSessions(days, options), loadRates(storeHome(options)), repoIdentity(options.cwd ?? process.cwd()),
  ]);
  return { sessions: sessions.reverse(), rates, repo: repoName(identity), days };
}

export interface UiTerminal { input: ReadStream; output: WriteStream }

export function requireTerminal(terminal: UiTerminal): void {
  if (!terminal.input.isTTY || !terminal.output.isTTY || process.env["TERM"] === "dumb") {
    throw new Error("session ui needs an interactive terminal. Run session week for printable output.");
  }
}

/** Terminal ownership is scoped to this promise, including failure and signals. */
export async function runUi(
  initial: UiData,
  refresh: () => Promise<UiData>,
  palette: Palette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout },
): Promise<void> {
  requireTerminal(terminal);
  const { input, output } = terminal;
  const theme = palette === plainPalette ? plainUiTheme : uiThemeFor({ isTTY: output.isTTY });
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing === true;
  let data = initial;
  let state = initialState();
  let maxScroll = 0;
  let notice = "";
  let refreshing = false;
  let closed = false;

  await new Promise<void>((resolve, reject) => {
    const draw = (): void => {
      if (closed) return;
      const frame = renderUi(data, state, output.columns || 80, output.rows || 24, palette, notice, theme);
      maxScroll = frame.maxScroll;
      output.write(theme.background + screenControl.paint + frame.lines.join("\r\n"));
    };
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      input.off("keypress", keypress);
      input.off("end", finish);
      input.off("error", fail);
      output.off("error", fail);
      output.off("resize", repaint);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.off("SIGHUP", hangup);
      process.off("exit", cleanup);
      try { input.setRawMode(wasRaw); } finally {
        if (!wasFlowing) input.pause();
        output.write(theme.reset + screenControl.leave);
      }
    };
    const finish = (): void => { cleanup(); resolve(); };
    const fail = (error: unknown): void => { cleanup(); reject(error); };
    const interrupt = (): void => { process.exitCode = 130; finish(); };
    const terminate = (): void => { process.exitCode = 143; finish(); };
    const hangup = (): void => { process.exitCode = 129; finish(); };
    const repaint = (): void => { try { draw(); } catch (error) { fail(error); } };
    const reload = async (): Promise<void> => {
      refreshing = true;
      notice = "Refreshing records and Git outcomes…";
      repaint();
      const id = visibleSessions(data.sessions, state)[state.selected]?.id;
      try {
        const updated = await refresh();
        if (closed) return;
        data = updated;
        state.selected = Math.max(0, visibleSessions(data.sessions, state).findIndex((session) => session.id === id));
        state.scroll = 0;
        notice = "Refreshed. r refresh · q quit";
      } catch (error) {
        notice = `Refresh failed: ${error instanceof Error ? error.message : String(error)}. r retries.`;
      } finally {
        refreshing = false;
        repaint();
      }
    };
    const keypress = (_text: string, key: UiKey = {}): void => {
      try {
        if (key.ctrl && key.name === "c") { interrupt(); return; }
        if (!state.searching && key.name === "q") { finish(); return; }
        if (!state.searching && key.name === "r") {
          if (!refreshing) void reload();
          return;
        }
        state = navigate(state, key, visibleSessions(data.sessions, state).length, maxScroll);
        draw();
      } catch (error) { fail(error); }
    };
    try {
      emitKeypressEvents(input);
      input.on("keypress", keypress);
      input.on("end", finish);
      input.on("error", fail);
      output.on("error", fail);
      output.on("resize", repaint);
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
      process.on("SIGHUP", hangup);
      process.on("exit", cleanup);
      input.setRawMode(true);
      input.resume();
      output.write(screenControl.enter);
      draw();
    } catch (error) { fail(error); }
  });
}
