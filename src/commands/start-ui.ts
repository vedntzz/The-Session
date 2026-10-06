import { emitKeypressEvents } from "node:readline";
import { currentCommit, isRepo, tryGit } from "../git.js";
import { withOutcomes } from "../observe.js";
import { getOpenSession, readSessions, repoIdentity, repoName, intentSourceOf, type Session } from "../store.js";
import { plainPalette, plainUiTheme, screenControl, uiThemeFor, type Palette } from "../render/palette.js";
import { renderStartUi } from "../render/tui/start-screen.js";
import { draftScope, editStart, initialStartState, pasteStartText, type StartKey } from "../render/tui/start-state.js";
import { safeText } from "../render/tui/text.js";
import { startSession, type StartOptions } from "./start.js";
import { stopSession } from "./stop.js";
import type { UiTerminal } from "./ui.js";

export interface StartUiOptions extends StartOptions { startTerminal?: UiTerminal; returnToHome?: boolean }
export interface StartUiResult { session?: Session; action: "cancelled" | "open" | "started" | "stopped"; exitWorkspace?: boolean }

export function canStartUi(terminal: UiTerminal): boolean {
  return terminal.input.isTTY === true && terminal.output.isTTY === true && process.env["TERM"] !== "dumb";
}

/** A draft is never evidence. The existing start/stop commands own every write. */
export async function runStartUi(options: StartUiOptions = {}, palette: Palette = plainPalette): Promise<StartUiResult> {
  const terminal = options.startTerminal ?? { input: process.stdin, output: process.stdout };
  if (!canStartUi(terminal)) throw new Error('No intent given. Run: session start "what you are about to do"');
  const cwd = options.cwd ?? process.cwd();
  if (!(await isRepo(cwd))) throw new Error(`Not a git repository: ${cwd}. Run session start from inside your repo.`);
  if (!(await currentCommit(cwd))) throw new Error("No commits yet, so there is no base to diff against. Make one commit first.");
  if (options.scope !== undefined && !options.scope.some(path => path.trim())) {
    throw new Error('--scope was given but held no paths. Name a file or folder, or leave --scope off.');
  }
  const [identity, branch, open] = await Promise.all([
    repoIdentity(cwd), tryGit(cwd, ["branch", "--show-current"]), getOpenSession(options),
  ]);
  const { input, output } = terminal;
  const theme = palette === plainPalette ? plainUiTheme : uiThemeFor({ isTTY: output.isTTY });
  let draft = initialStartState(options.scope);
  let session = open && intentSourceOf(open) !== "captured" ? open : undefined;
  let action: StartUiResult["action"] = session ? "open" : "cancelled";
  let notice = "";
  let busy = false;
  let closed = false;
  let exitRequested = false;
  let exitWorkspace = false;
  let maxScroll = 0;
  let paste: string | undefined;
  let outcomeKnown = true;
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing === true;
  if (input.readableEnded || input.destroyed || output.destroyed) return { session, action, exitWorkspace: true };

  return new Promise<StartUiResult>((resolve, reject) => {
    const draw = (): void => {
      if (closed) return;
      const frame = renderStartUi({ repo: repoName(identity), branch: branch?.trim() || "detached HEAD",
        draft, session, notice, busy, outcomeKnown, returnToHome: options.returnToHome,
        capturedOpen: open !== undefined && intentSourceOf(open) === "captured" },
      output.columns || 80, output.rows || 24, theme);
      maxScroll = frame.maxScroll;
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
    const finish = (): void => {
      if (closed) return;
      if (busy) { exitRequested = true; notice = `Finishing the current action before returning to ${options.returnToHome && !exitWorkspace ? "Home" : "the terminal"}.`; repaint(); return; }
      try { cleanup(); resolve({ session, action, ...(exitWorkspace ? { exitWorkspace: true } : {}) }); } catch (error) { reject(error); }
    };
    const fail = (error: unknown): void => { try { cleanup(); } catch { /* Preserve the original failure. */ } reject(error); };
    const end = (): void => { exitWorkspace = true; finish(); };
    const cancel = (code: number): void => { process.exitCode = code; end(); };
    const interrupt = (): void => cancel(130);
    const terminate = (): void => cancel(143);
    const hangup = (): void => cancel(129);
    const repaint = (): void => { try { draw(); } catch (error) { fail(error); } };
    const perform = async (kind: "start" | "finish" | "refresh"): Promise<void> => {
      busy = true; notice = kind === "start" ? "Saving your starting plan…" : kind === "finish" ? "Recording changes against your plan…" : "Refreshing the session…";
      repaint();
      try {
        if (kind === "start") {
          const scope = draftScope(draft);
          session = await startSession(draft.goal, { ...options, scope: scope.length ? scope : undefined,
            onCapturedClosed: stopped => options.onCapturedClosed?.(stopped),
          });
          action = "started";
          notice = options.returnToHome ? "Session started. Returning to Home; your session stays open."
            : "Session started. q returns to the terminal; your session stays open.";
        } else if (kind === "finish") {
          const stopped = await stopSession({ ...options, expectedSessionId: session!.id });
          // Recompute the outcome through the same path as week, never from the stored field.
          session = stopped; action = "stopped";
          outcomeKnown = false;
          session = (await withOutcomes([stopped], cwd))[0]!;
          outcomeKnown = true;
          notice = `Session finished. Review every changed path; q returns to ${options.returnToHome ? "Home" : "the terminal"}.`;
          draft.scroll = 0;
        } else {
          const current = (await readSessions(options)).find(value => value.id === session!.id);
          if (!current) throw new Error("This session could not be found. Return to the terminal and run session week.");
          session = current;
          if (session.endedAt !== null) {
            action = "stopped"; outcomeKnown = false;
            session = (await withOutcomes([session], cwd))[0]!; outcomeKnown = true;
          }
          notice = "Refreshed from the record.";
        }
      } catch (error) {
        notice = safeText(error instanceof Error ? error.message : String(error));
      } finally {
        busy = false;
        if (closed) return;
        if (exitRequested || options.returnToHome && kind === "start" && action === "started") finish(); else repaint();
      }
    };
    const keypress = (text: string, key: StartKey = {}): void => {
      try {
        if (closed) return;
        if (key.sequence === "\u001b[200~") { paste = ""; return; }
        if (paste !== undefined) {
          if (key.sequence === "\u001b[201~") {
            if (!session && !busy) draft = pasteStartText(draft, paste);
            paste = undefined; notice = ""; repaint();
          } else paste = (paste + (key.sequence ?? text ?? "")).slice(0, 65_536);
          return;
        }
        if (key.ctrl && key.name === "c") { interrupt(); return; }
        if (key.name === "escape" || session && key.name === "q") { finish(); return; }
        if (busy || (output.columns || 80) < 60 || (output.rows || 24) < 20) return;
        if (key.name === "pageup" || key.name === "pagedown") {
          draft.scroll = Math.max(0, Math.min(maxScroll, draft.scroll + (key.name === "pageup" ? -5 : 5)));
          draft.followCursor = false;
        } else if (session) {
          if (key.name === "r") { void perform("refresh"); return; }
          if (session.endedAt === null && key.name === "f") { void perform("finish"); return; }
        } else if (key.ctrl && key.name === "s" || key.name === "return" && draft.field === "start") {
          if (!draft.goal.trim()) { notice = "Write a goal before starting. Nothing has been saved."; draft.field = "goal"; }
          else { void perform("start"); return; }
        } else {
          draft = editStart(draft, { ...key, sequence: key.sequence ?? text }); notice = "";
        }
        draw();
      } catch (error) { fail(error); }
    };
    try {
      emitKeypressEvents(input);
      input.on("keypress", keypress); input.on("end", end); input.on("error", fail);
      output.on("error", fail); output.on("resize", repaint);
      process.on("SIGINT", interrupt); process.on("SIGTERM", terminate); process.on("SIGHUP", hangup); process.on("exit", cleanup);
      input.setRawMode(true); input.resume();
      output.write(screenControl.enter + screenControl.pasteOn); draw();
    } catch (error) { fail(error); }
  });
}
