import { emitKeypressEvents } from "node:readline";
import { tryGit } from "../git.js";
import { repoIdentity, repoName, type StoreOptions } from "../store.js";
import { plainPalette, plainUiTheme, screenControl, uiThemeFor, type Palette } from "../render/palette.js";
import { homeActions, renderHomeUi, type HomeAction, type HomeView } from "../render/tui/home.js";
import { moveMenuSelection, renderUiMenu, UI_MENU } from "../render/tui/menu.js";
import type { UiScreen } from "../render/tui/navigation.js";
import type { UiKey } from "../render/tui/state.js";
import { homeState } from "./home.js";
import { requireTerminal, type UiTerminal } from "./ui.js";

export async function loadAppUi(options: StoreOptions = {}): Promise<HomeView> {
  const cwd = options.cwd ?? process.cwd();
  const [home, identity, branch] = await Promise.all([
    homeState(options), repoIdentity(cwd), tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  return { home, repo: repoName(identity), branch: branch?.trim() === "HEAD" ? "Detached HEAD" : branch?.trim() || "Branch unavailable" };
}

/** Owns the terminal until exit or selection; feature commands run only after it returns. */
export async function runAppUi(view: HomeView, palette: Palette = plainPalette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout }): Promise<HomeAction | undefined> {
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
    const finish = (action?: HomeAction): void => { try { cleanup(); resolve(action); } catch (error) { reject(error); } };
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
