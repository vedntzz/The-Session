import { emitKeypressEvents } from "node:readline";
import { tryGit } from "../git.js";
import { repoIdentity, repoName, type StoreOptions } from "../store.js";
import { plainPalette, plainUiTheme, screenControl, uiThemeFor, type Palette } from "../render/palette.js";
import { homeActions, renderHomeUi, type HomeAction, type HomeView } from "../render/tui/home.js";
import { moveMenuSelection, renderUiMenu, UI_MENU } from "../render/tui/menu.js";
import type { UiScreen } from "../render/tui/navigation.js";
import { initialState, type UiKey } from "../render/tui/state.js";
import { navigateWeek, renderWeekUi, WEEK_WINDOWS } from "../render/tui/week.js";
import { homeState } from "./home.js";
import { runStartUi, type StartUiOptions } from "./start-ui.js";
import { loadUi, requireTerminal, runUi, runUiBrowser, type UiBrowserResult, type UiTerminal } from "./ui.js";
import { loadWeekUi } from "./week-ui.js";
import { weekExportActions } from "./week-export-ui.js";
import type { WeekOptions } from "./week.js";
import { prTemplateUi } from "./pr-template-ui.js";
import { loadScanUi } from "./scan-ui.js";
import { scanExportActions } from "./scan-export-ui.js";
import { DEFAULT_SCAN_DAYS, type ScanOptions } from "./scan.js";
import { navigateScan, renderScanUi, SCAN_WINDOWS, visibleScanned } from "../render/tui/scan.js";
import { loadPrUi } from "./pr-ui.js";
import { canReturnPrHome, navigatePr } from "../render/tui/pr.js";
import { runAgentsUi, type AgentsUiResult } from "./agents-browser-ui.js";
import { loadDebtUi } from "./debt-ui.js";
import { navigateDebt, renderDebtUi, visibleDebtRepos } from "../render/tui/debt.js";
import { runOutcomesUi } from "./outcomes-ui.js";

export async function loadAppUi(options: StoreOptions = {}): Promise<HomeView> {
  const cwd = options.cwd ?? process.cwd();
  const [home, identity, branch] = await Promise.all([
    homeState(options), repoIdentity(cwd), tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  return { home, repo: repoName(identity), branch: branch?.trim() === "HEAD" ? "Detached HEAD" : branch?.trim() || "Branch unavailable" };
}

/** Owns the terminal until exit or selection; feature commands run only after it returns. */
export async function runAppUi(view: HomeView, palette: Palette = plainPalette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout },
  remember?: (position: { selected: number; scroll: number }) => void): Promise<HomeAction | undefined> {
  requireTerminal(terminal);
  const { input, output } = terminal;
  const theme = palette === plainPalette ? plainUiTheme : uiThemeFor({ isTTY: output.isTTY });
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing === true;
  const actions = homeActions(view.home);
  let menu = false; let menuSelected: UiScreen = "home";
  let selected = Math.max(0, Math.min(actions.length - 1, view.selected ?? 0));
  let scroll = view.scroll ?? 0; let maxScroll = 0;
  let closed = false; let pasting = false;
  return new Promise<HomeAction | undefined>((resolve, reject) => {
    const draw = (): void => {
      if (closed) return;
      const columns = output.columns || 80; const rows = output.rows || 24;
      const frame: { lines: string[]; maxScroll?: number } = menu ? renderUiMenu({ ...view, selected: menuSelected }, columns, rows, theme)
        : renderHomeUi({ ...view, selected, scroll }, columns, rows, theme);
      if (frame.maxScroll !== undefined) maxScroll = frame.maxScroll;
      output.write(theme.background + screenControl.paint + frame.lines.join("\r\n"));
    };
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      input.off("keypress", keypress); input.off("end", end); input.off("error", fail);
      output.off("error", fail); output.off("resize", repaint);
      process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); process.off("SIGHUP", hangup); process.off("exit", cleanup);
      try { input.setRawMode(wasRaw); } finally {
        if (!wasFlowing) input.pause();
        if (!output.destroyed) output.write(screenControl.pasteOff + theme.reset + screenControl.leave);
      }
    };
    const finish = (action?: HomeAction): void => { try { cleanup(); remember?.({ selected, scroll }); resolve(action); } catch (error) { reject(error); } };
    const end = (): void => finish();
    const fail = (error: unknown): void => { try { cleanup(); } catch { /* Preserve the original failure. */ } reject(error); };
    const cancel = (code: number): void => { process.exitCode = code; finish(); };
    const interrupt = (): void => cancel(130);
    const terminate = (): void => cancel(143);
    const hangup = (): void => cancel(129);
    const repaint = (): void => { try { draw(); } catch (error) { fail(error); } };
    const keypress = (_text: string, key: UiKey = {}): void => {
      try {
        if (closed) return;
        if (key.sequence === "\u001b[200~") { pasting = true; return; }
        if (pasting) { if (key.sequence === "\u001b[201~") pasting = false; return; }
        if (key.ctrl && key.name === "c") { interrupt(); return; }
        if (key.name === "q") { finish(); return; }
        if (key.name === "escape") { if (menu) { menu = false; draw(); } else finish(); return; }
        if ((output.columns || 80) < 60 || (output.rows || 24) < 20) return;
        if (key.name === "m") menu = !menu;
        else if (key.name === "up" || key.name === "down") {
          const delta = key.name === "up" ? -1 : 1;
          if (menu) menuSelected = moveMenuSelection(menuSelected, delta);
          else selected = Math.max(0, Math.min(actions.length - 1, selected + delta));
        } else if (!menu && (key.name === "pageup" || key.name === "pagedown")) {
          scroll = Math.max(0, Math.min(maxScroll, Math.min(scroll, maxScroll) + (key.name === "pageup" ? -5 : 5)));
        } else if (key.name === "return") {
          if (menu && menuSelected === "home") menu = false;
          else { finish(menu ? UI_MENU.find(item => item.screen === menuSelected) : actions[selected]); return; }
        }
        draw();
      } catch (error) { fail(error); }
    };
    try {
      emitKeypressEvents(input);
      input.on("keypress", keypress); input.on("end", end); input.on("error", fail);
      output.on("error", fail); output.on("resize", repaint);
      process.on("SIGINT", interrupt); process.on("SIGTERM", terminate); process.on("SIGHUP", hangup); process.on("exit", cleanup);
      input.setRawMode(true); input.resume(); output.write(screenControl.enter + screenControl.pasteOn); draw();
    } catch (error) { fail(error); }
  });
}

/** Each screen releases the terminal before the next takes ownership. */
export async function runWorkspaceUi(options: StartUiOptions & WeekOptions & ScanOptions = {}, palette: Palette = plainPalette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout }): Promise<HomeAction | undefined> {
  let view = await loadAppUi(options);
  let position = { selected: 0, scroll: 0 };
  let history: UiBrowserResult | undefined;
  let week: UiBrowserResult | undefined;
  let pr: UiBrowserResult | undefined;
  let scan: UiBrowserResult | undefined;
  let agents: AgentsUiResult | undefined;
  let debt: UiBrowserResult | undefined;
  let outcomes: UiBrowserResult | undefined;
  const prScreen = prTemplateUi(options);
  while (!terminal.input.readableEnded && !terminal.input.destroyed && !terminal.output.destroyed) {
    const action = await runAppUi(view, palette, terminal, state => { position = state; });
    if (action?.screen === "start") {
      const result = await runStartUi({ ...options, startTerminal: terminal, returnToHome: true }, palette);
      if (result.exitWorkspace) return;
      if (result.action === "started") position = { selected: 0, scroll: 0 };
    } else if (action?.screen === "sessions") {
      const refresh = (): ReturnType<typeof loadUi> => loadUi(undefined, options);
      const browser = { returnToHome: true,
        state: action.selectedSessionId ? initialState() : history?.state,
        selectedSessionId: action.selectedSessionId ?? history?.selectedSessionId };
      history = await runUi(await refresh(), refresh, palette, terminal, browser);
      if (history.exitWorkspace) return;
    } else if (action?.screen === "week") {
      const refresh = (days = week?.days ?? WEEK_WINDOWS[0]): ReturnType<typeof loadWeekUi> => loadWeekUi(days, options);
      week = await runUi(await refresh(), refresh, palette, terminal, { ...week,
        returnToHome: true, render: renderWeekUi, navigate: navigateWeek, windows: WEEK_WINDOWS, actions: weekExportActions(options) });
      if (week.exitWorkspace) return;
    } else if (action?.screen === "pr") {
      const refresh = (): ReturnType<typeof loadPrUi> => loadPrUi(options);
      const data = await refresh();
      pr = await runUi(data, refresh, palette, terminal, { ...pr, returnToHome: true,
        state: pr?.state ?? { ...initialState(), expanded: false },
        selectedSessionId: pr?.selectedSessionId ?? data.sessions.find(session => session.endedAt !== null)?.id,
        ...prScreen, navigate: navigatePr, canReturnHome: canReturnPrHome, refreshNotice: "Refreshing recorded sessions…" });
      if (pr.exitWorkspace) return;
    } else if (action?.screen === "scan") {
      const refresh = (days = scan?.days ?? DEFAULT_SCAN_DAYS): ReturnType<typeof loadScanUi> => loadScanUi(days, options);
      scan = await runUiBrowser(await refresh(), refresh, palette, terminal, { ...scan, returnToHome: true,
        render: renderScanUi, select: visibleScanned, navigate: navigateScan, windows: SCAN_WINDOWS,
        refreshNotice: "Reading local transcripts…", actions: scanExportActions(options) });
      if (scan.exitWorkspace) return;
    } else if (action?.screen === "agents") {
      agents = await runAgentsUi(options, palette, terminal, agents);
      if (agents.exitWorkspace) return;
    } else if (action?.screen === "debt") {
      const refresh = (): ReturnType<typeof loadDebtUi> => loadDebtUi(options);
      debt = await runUiBrowser(await refresh(), refresh, palette, terminal, { ...debt, returnToHome: true,
        render: renderDebtUi, select: visibleDebtRepos, navigate: navigateDebt,
        refreshNotice: "Reading recurring misses from all local records…" });
      if (debt.exitWorkspace) return;
    } else if (action?.screen === "outcomes") {
      outcomes = await runOutcomesUi(options, palette, terminal, outcomes);
      if (outcomes.exitWorkspace) return;
    } else return action;
    view = { ...await loadAppUi(options), ...position };
  }
  return undefined;
}
