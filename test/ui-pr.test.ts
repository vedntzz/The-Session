import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as observe from "../src/observe.js";
import * as sweep from "../src/commands/sweep.js";
import { loadPrUi } from "../src/commands/pr-ui.js";
import { runUi, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { renderPr } from "../src/render/pr.js";
import { ansiPalette, plainPalette, plainUiTheme, screenControl, uiThemeFor } from "../src/render/palette.js";
import { canReturnPrHome, navigatePr, renderPrUi } from "../src/render/tui/pr.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth, fold } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, zeroCost, type IntentSource, type Session } from "../src/store.js";

const session = (extra: Partial<Session> = {}): Session => ({ id: "finished", repo: "path:/example", intent: "finish work", scope: ["src"], baseline: [], reality: ["src/a.ts"], drift: [], cost: { ...zeroCost(), turns: 2, model: "future-model", inputTokens: 20 }, outcome: "abandoned", startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", ...extra });
const data = (sessions = [session()]) => ({ sessions, repo: "example", branch: "main", rates: new Map() });
const chooser = () => ({ ...initialState(), expanded: false });
const browser = { returnToHome: true, render: renderPrUi, navigate: navigatePr, canReturnHome: canReturnPrHome, refreshNotice: "Refreshing recorded sessions…" };
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns: 110, rows: 32 });
  let text = ""; output.on("data", chunk => { text += String(chunk); }); return { input, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
function documentLines(input: ReturnType<typeof data>, columns = 60, rows = 20): string[] {
  const state = { ...chooser(), expanded: true }; const top = renderPrUi(input, state, columns, rows);
  const start = top.lines.findIndex(line => line.includes("MARKDOWN PREVIEW")) + 1; const end = top.lines.findLastIndex(line => /^─+$/u.test(line.trim()));
  const pages = Array.from({ length: top.maxScroll + 1 }, (_, scroll) => renderPrUi(input, { ...state, scroll }, columns, rows).lines);
  return [...pages.map(lines => lines[start]!), ...pages.at(-1)!.slice(start + 1, end)].map(line => line.slice(2, -2).trimEnd());
}
let root: string; let options: { cwd: string; home: string; adapters: never[] };
const record = (extra: Partial<Session> = {}) => { const { repo: _repo, ...fields } = session(extra); return appendSession(fields, options); };
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-pr-ui-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("Pull request preview inside the workspace", () => {
  it("loads newest records and their stored outcomes without any outcome walk, sweep or ledger write", async () => {
    await record({ id: "newer", startedAt: "2026-10-03T12:00:00Z", endedAt: "2026-10-03T13:00:00Z" }); await record({ id: "older" });
    const file = await resolveStoreFile(options); const before = await readFile(file); const walk = vi.spyOn(observe, "withOutcomes"); const swept = vi.spyOn(sweep, "sweepFirst");
    const loaded = await loadPrUi(options); expect(loaded.sessions.map(row => row.id)).toEqual(["newer", "older"]); expect(loaded.sessions.map(row => row.outcome)).toEqual(["abandoned", "abandoned"]);
    expect(walk).not.toHaveBeenCalled(); expect(swept).not.toHaveBeenCalled(); expect(await readFile(file)).toEqual(before);
  });
  it("shows every safely folded native line for declared, primed and captured records with unknown cost", () => {
    for (const source of ["declared", "primed", "captured"] as IntentSource[]) {
      const record = session({ intentSource: source, intent: "First goal.\n" + "Full prompt detail ".repeat(30), reality: Array.from({ length: 24 }, (_, n) => `src/deep/file-${n}.ts`), drift: ["outside/file.ts"],
        ...(source === "captured" ? { scope: [], drift: [] } : {}), ...(source === "primed" ? { proposal: { rule: "declared-drift-v1" as const, intent: "First goal.", scope: ["src"], candidates: [], history: 0, comparable: 0, tracked: 1, omitted: 0 } } : {}) });
      const expected = renderPr(record, new Map()).split("\n").flatMap(line => fold(line, 55)).map(line => line.trimEnd());
      expect(documentLines(data([record])).slice(0, expected.length)).toEqual(expected);
    }
  });
  it("keeps chooser and preview bounded, colour-equivalent and safe from record escape sequences", () => {
    const record = session({ intent: "Goal\u001b[2J\u001b]0;fake title\u0007tail", reality: ["src/" + "long".repeat(40) + ".ts"] }); const input = data([record]);
    const query = "source:declared source:primed source:captured outside:yes outside:no outcome:open outcome:merged outcome:abandoned outcome:empty";
    for (const state of [chooser(), { ...chooser(), query }, { ...chooser(), expanded: true }, { ...chooser(), help: true }]) {
      const plain = renderPrUi(input, state, 60, 20).lines; const colour = renderPrUi(input, state, 60, 20, ansiPalette, "", uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines;
      expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).not.toContain("\u001b");
      if (!state.expanded) for (const key of ["o", "s", "d"]) expect(plain.join("\n")).toContain(`[${key}]`);
    }
    expect(documentLines(input).join("").replace(/\s/gu, "")).toContain("src/" + "long".repeat(40) + ".ts");
  });
  it("does not interpret Markdown headings inside the full captured prompt as measured drift", () => {
    const record = session({ intentSource: "captured", scope: [], drift: [], intent: "First goal.\n## Outside declared scope\nThis is only pasted prompt text." });
    const paint = vi.fn(plainUiTheme.paint); renderPrUi(data([record]), { ...chooser(), expanded: true }, 110, 60, plainPalette, "", { ...plainUiTheme, paint });
    expect(paint.mock.calls.filter(([, role]) => role === "drift")).toHaveLength(0);
  });
  it("uses Enter and Esc in layers and never opens a preview while finishing a search or with no match", () => {
    let state = navigatePr(chooser(), { name: "return" }, 1, 40); expect(state.expanded).toBe(true); expect(canReturnPrHome(state)).toBe(false);
    state = navigatePr({ ...state, help: true }, { name: "escape" }, 1, 40); expect(state).toMatchObject({ help: false, expanded: true });
    state = navigatePr(state, { sequence: "/" }, 1, 40); expect(state).toMatchObject({ searching: true, expanded: false });
    state = navigatePr(state, { name: "return" }, 1, 40); expect(state).toMatchObject({ searching: false, expanded: false });
    state = navigatePr({ ...state, query: "missing", source: 1 }, { name: "escape" }, 0, 40); expect(state).toMatchObject({ expanded: false, query: "", source: 0 }); expect(canReturnPrHome(state)).toBe(true);
    expect(navigatePr(chooser(), { name: "return" }, 0, 40).expanded).toBe(false); expect(navigatePr(chooser(), { name: "e" }, 1, 40).expanded).toBe(false);
  });
  it("shows useful empty and invalid-filter states instead of an empty preview", () => {
    expect(renderPrUi(data([]), chooser(), 60, 20).lines.join("\n")).toContain("No sessions yet.");
    expect(renderPrUi(data(), { ...chooser(), query: "missing" }, 110, 32).lines.join("\n")).toContain("No matches. Esc clears filters.");
    const invalid = renderPrUi(data(), { ...chooser(), query: "source:unknown" }, 110, 32).lines.join("\n"); expect(invalid).toContain("source: use declared / primed / captured"); expect(invalid).not.toContain("MARKDOWN PREVIEW");
  });
  it("preserves selected ID through refresh, remembers preview/scroll on reentry, and closes preview before Home", async () => {
    const term = terminal(); let finish!: (input: ReturnType<typeof data>) => void; const input = data([session({ id: "first", intent: "first goal" }), session({ id: "keep", intent: "keep goal", reality: Array.from({ length: 24 }, (_, n) => `src/file-${n}.ts`) })]);
    const running = runUi(input, () => new Promise(resolve => { finish = resolve; }), plainPalette, term.io, { ...browser, state: { ...chooser(), selected: 1 } });
    term.input.write("\rr"); expect(term.frame()).toContain("Refreshing recorded sessions"); expect(term.frame()).not.toContain("Git outcomes"); finish(data([session({ id: "new" }), ...input.sessions])); await wait(term, "Refreshed.");
    term.input.write("\u001b[6~q"); const saved = await running; expect(saved).toMatchObject({ selectedSessionId: "keep", state: { expanded: true, scroll: 5 } });
    const reentry = runUi(data([session({ id: "new" }), ...input.sessions]), async () => input, plainPalette, term.io, { ...browser, ...saved }); expect(term.frame()).toContain("MARKDOWN PREVIEW");
    term.input.emit("keypress", "", { name: "escape" }); expect(term.frame()).toContain("Recorded result"); term.input.emit("keypress", "", { name: "escape" }); expect((await reentry).exitWorkspace).toBe(false);
  });
  it("lets search choose a different session and keeps a running preview explicitly labelled", async () => {
    const term = terminal(); const runningRecord = session({ id: "running", intent: "running goal", endedAt: null, reality: [] }); const input = data([session(), runningRecord]);
    const running = runUi(input, async () => input, plainPalette, term.io, { ...browser, state: chooser() }); term.input.write("/running\r"); expect(term.frame()).not.toContain("MARKDOWN PREVIEW");
    term.input.write("\r"); expect(term.frame()).toContain("Running; stop to record changed files"); term.input.write("q"); expect((await running).selectedSessionId).toBe("running");
  });
  it.each([false, true])("opens PR from Home with correct default selection (only running: %s), persists it and releases EOF", async onlyRunning => {
    if (!onlyRunning) await record(); await record({ id: "running", intent: "running goal", endedAt: null, startedAt: "2026-10-03T12:00:00Z" });
    const file = await resolveStoreFile(options); const before = await readFile(file); const term = terminal(); const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
    const open = () => term.input.write("m\u001b[B\u001b[B\u001b[B\u001b[B\r"); await wait(term, "OVERVIEW"); const walk = vi.spyOn(observe, "withOutcomes"); open(); await wait(term, "Recorded result"); term.input.write("\r");
    expect(term.frame()).toContain(onlyRunning ? "Running; stop to record changed files" : "Finished session"); expect(walk).not.toHaveBeenCalled();
    term.input.write("q"); await wait(term, "OVERVIEW"); open(); await wait(term, "MARKDOWN PREVIEW"); term.input.end(); await running;
    expect(term.input.listenerCount("keypress")).toBe(0); expect(term.input.listenerCount("end")).toBe(0); expect(await readFile(file)).toEqual(before);
  });
});
