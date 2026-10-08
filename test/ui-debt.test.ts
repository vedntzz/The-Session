import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { debtReport } from "../src/commands/debt.js";
import { loadDebtUi } from "../src/commands/debt-ui.js";
import * as sweep from "../src/commands/sweep.js";
import { runUiBrowser, type UiBrowserData, type UiTerminal } from "../src/commands/ui.js";
import { debtOf } from "../src/debt.js";
import * as observe from "../src/observe.js";
import { loadRates, parseRates, type RateTable } from "../src/pricing.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { debtCost, debtFinding, formatDebtNotes, NOTHING_RECORDED } from "../src/render/terminal/debt.js";
import { navigateDebt, renderDebtUi, visibleDebtRepos, type DebtUiData } from "../src/render/tui/debt.js";
import { UI_MENU } from "../src/render/tui/menu.js";
import { initialState, SCROLL_STEP } from "../src/render/tui/state.js";
import { cellWidth, safeText } from "../src/render/tui/text.js";
import { appendSession, repoIdentity, repoName, zeroCost, type Session } from "../src/store.js";

type Data = DebtUiData & UiBrowserData;
const rates = parseRates('{"models":{"qa-model":{"input":1,"cacheRead":0,"cacheCreation":0,"output":0}}}', "QA rates");
const REPO = "remote:example.test/current";
let next = 0;
const session = (over: Partial<Session> = {}): Session => ({ id: `s${++next}`, repo: REPO, intent: "fix service", scope: ["planned"], baseline: [], reality: ["src/api.ts"], drift: ["src/api.ts"], startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", outcome: "abandoned", cost: { ...zeroCost(), turns: 1, inputTokens: 1_000_000, model: "qa-model" }, ...over });
const data = (records: Session[] = [], here = REPO, prices: RateTable = rates): Data => ({ ...debtOf(records, prices), here, repo: repoName(here) });
const browser = { returnToHome: true, render: renderDebtUi, select: visibleDebtRepos, navigate: navigateDebt, refreshNotice: "Reading recurring misses from all local records…" };
const compact = (text: string) => text.replace(/\s/gu, "");
const render = (input: Data, state = initialState()) => renderDebtUi(input, state, 160, 300).lines.join("\n");
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); }); return { input, output, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
let root: string; let options: { cwd: string; home: string; adapters: never[] };
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); next = 0; root = await mkdtemp(path.join(tmpdir(), "session-ui-debt-")); options = { cwd: path.join(root, "z-current"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function record(cwd = options.cwd, over: Partial<Session> = {}) {
  const { repo: _repo, ...fields } = session(over); return appendSession(fields, { ...options, cwd });
}
async function bytes() {
  const names = (await readdir(options.home)).filter(name => name.endsWith(".jsonl")).sort();
  return Promise.all(names.map(async name => [name, await readFile(path.join(options.home, name))] as const));
}

describe("Recurring misses workspace", () => {
  it("reads an absent store without creating files or presenting an all-clear", async () => {
    const input = await loadDebtUi(options); expect(input.repos).toEqual([]); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
    expect(compact(render(input))).toContain(compact(NOTHING_RECORDED)); expect(render(input)).not.toContain("no file drifted");
  });
  it("matches the native all-repository reader, merges identity aliases and leaves signed bytes unchanged", async () => {
    const git = promisify(execFile); await git("git", ["init", "-q", options.cwd]);
    await record(); await record(); await git("git", ["-C", options.cwd, "remote", "add", "origin", "https://example.test/current.git"]); await record();
    const other = path.join(root, "alpha"); await mkdir(other); await record(other); await record(other); await record(other, { drift: [] });
    const before = await bytes(); const names = await readdir(options.home); const swept = vi.spyOn(sweep, "sweepFirst"); const resolved = vi.spyOn(observe, "withOutcomes");
    const input = await loadDebtUi(options); expect(input.repos).toEqual((await debtReport(await loadRates(options.home), options)).repos); expect(input.here).toBe(await repoIdentity(options.cwd));
    expect(input.repos).toHaveLength(2); const current = input.repos.find(repo => repo.repo === input.here)!; expect(current.history).toBe(3); expect(current.files?.[0]?.sessions).toBe(3);
    expect(input.repos.find(repo => repo.repo !== input.here)?.files).toEqual([]); expect(swept).not.toHaveBeenCalled(); expect(resolved).not.toHaveBeenCalled(); expect(await bytes()).toEqual(before); expect(await readdir(options.home)).toEqual(names);
  });
  it("clears only a later accepted scope, keeping an original suggestion separate", () => {
    const history = Array.from({ length: 3 }, () => session()); const proposal = { rule: "declared-drift-v1" as const, intent: "fix service", scope: ["src"], candidates: [], history: 3, comparable: 3, tracked: 1, omitted: 0 };
    const suggested = session({ intentSource: "primed", proposal, scope: ["elsewhere"], drift: [] }); expect(data([...history, suggested]).repos[0]!.files?.map(file => file.path)).toEqual(["src/api.ts"]);
    expect(data([...history, { ...suggested, scope: ["src/"] }]).repos[0]!.files).toEqual([]); expect(proposal.scope).toEqual(["src"]);
  });
  it("keeps current first, searches display names and whole file lists, and never searches identity prefixes", () => {
    const records = ["remote:zeta", "remote:alpha", "remote:beta"].flatMap(repo => Array.from({ length: 3 }, () => session({ repo, drift: ["src/api.ts", "src/other.ts"] })));
    const input = data(records, "remote:beta"); expect(visibleDebtRepos(input, initialState()).map(repo => repo.repo)).toEqual(["remote:beta", "remote:alpha", "remote:zeta"]);
    const matched = visibleDebtRepos(input, { ...initialState(), query: "BETA API.TS" }); expect(matched.map(repo => repo.repo)).toEqual(["remote:beta"]); expect(matched[0]!.files).toHaveLength(2);
    expect(visibleDebtRepos(input, { ...initialState(), query: "remote:" })).toEqual([]); expect(render(input, { ...initialState(), query: "api.ts beta" })).toContain('"src/other.ts"');
  });
  it("distinguishes short history, a measured empty finding and search with no matches", () => {
    const short = data([session(), session()]); const empty = data(Array.from({ length: 3 }, () => session({ drift: [] })));
    expect(render(short)).toContain("not enough history to judge — 2 sessions recorded, 3 needed"); expect(render(short)).not.toContain("no file drifted"); expect(render(empty)).toContain("no file drifted into 3 or more times");
    expect(render(empty, { ...initialState(), query: "missing" })).toContain("No matches. Esc clears search."); expect(render(empty, { ...initialState(), help: true })).toContain("A later accepted scope clears a file");
  });
  it("renders exact native zero, unpriced, uncaptured and partial whole-session costs without totals", () => {
    const measured = { ...zeroCost(), turns: 1, model: "qa-model" }; const missing = { ...measured, inputTokens: 1, model: "future-model" };
    for (const costs of [[measured, measured, measured], [missing, missing, missing], [zeroCost(), zeroCost(), zeroCost()], [session().cost, missing, zeroCost()]]) {
      const input = data(costs.map(cost => session({ cost, drift: ["src/api.ts", "src/other.ts"] }))); const repo = input.repos[0]!; const text = render(input);
      for (const file of repo.files!) expect(text).toContain(`Cost of these whole sessions: ${debtCost(file)}`);
      for (const note of formatDebtNotes({ repos: [repo] }, plainPalette).filter(Boolean)) expect(compact(text)).toContain(compact(note));
      expect(text).toContain(debtFinding(repo)); expect(text).not.toMatch(/total|ranking/iu);
      if (costs.every(cost => cost === measured)) expect(text).toContain("$0.00"); else if (costs.every(cost => cost === missing)) expect(text).not.toContain("$0.00");
    }
  });
  it("disables history filters while retaining literal editing, Help and Ctrl paging", () => {
    const state = { ...initialState(), expanded: false, scroll: 8 }; for (const name of ["o", "s", "d", "e"]) expect(navigateDebt(state, { name }, 2, 30)).toEqual(state);
    expect(navigateDebt(state, { name: "e", ctrl: true }, 2, 30)).toEqual(state); expect(navigateDebt(state, { name: "d", ctrl: true }, 2, 30).scroll).toBe(13);
    expect(navigateDebt({ ...state, searching: true }, { sequence: "osedr" }, 2, 30).query).toBe("osedr"); expect(navigateDebt({ ...state, help: true }, { name: "s" }, 2, 30)).toEqual({ ...state, help: true }); expect(navigateDebt(state, { name: "return" }, 2, 30).expanded).toBe(true);
  });
  it("reaches full hostile Unicode paths, timestamps, models and native notes with real PgDown at 60×20", async () => {
    const file = "src/修复 e\u0301 \u001b[2J " + "long path ".repeat(20) + "FINAL.ts"; const model = "future \u001b[2J " + "long model ".repeat(12) + "END";
    const input = data(Array.from({ length: 3 }, () => session({ drift: [file], cost: { ...session().cost, model } }))); const notice = "Unreadable local file " + "/long recovery path/".repeat(15);
    for (const help of [false, true]) for (const status of ["", notice]) { const plain = renderDebtUi(input, { ...initialState(), help }, 60, 20, plainPalette, status).lines; const colour = renderDebtUi(input, { ...initialState(), help }, 60, 20, ansiPalette, status, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines; expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).not.toContain("\u001b"); }
    const term = terminal(60, 20); const running = runUiBrowser(input, async () => input, plainPalette, term.io, browser); const pages: string[] = [];
    const body = () => { const lines = term.frame().split("\r\n"); return lines.slice(lines.findIndex(line => line.includes("> / Search repositories or files")) + 1, lines.findLastIndex(line => /^─+$/u.test(line.trim()))); };
    const limit = renderDebtUi(input, initialState(), 60, 20).maxScroll;
    for (let scroll = 0; scroll < limit;) { const advanced = Math.min(SCROLL_STEP, limit - scroll); pages.push(...body().slice(0, advanced)); term.input.write("\u001b[6~"); await new Promise(resolve => setImmediate(resolve)); scroll += advanced; }
    pages.push(...body());
    term.input.write("q"); await running; const seen = compact(pages.join("")); for (const value of [JSON.stringify(file), "3 sessions drifted", "Last touched: 2026-10-01T13:00:00Z", JSON.stringify(model), ...formatDebtNotes({ repos: input.repos }, plainPalette)]) expect(seen).toContain(compact(safeText(value)));
    const tiny = renderDebtUi(input, initialState(), 10, 5).lines; expect(tiny.length).toBeLessThanOrEqual(4); expect(tiny.every(line => cellWidth(line) <= 9)).toBe(true);
  });
  it("preserves a selected repository through refresh and cannot repaint Home after a late reload", async () => {
    const input = data(["remote:alpha", "remote:beta"].flatMap(repo => Array.from({ length: 3 }, () => session({ repo })))); let complete!: (value: Data) => void;
    const term = terminal(); const running = runUiBrowser(input, () => new Promise(resolve => { complete = resolve; }), plainPalette, term.io, { ...browser, selectedSessionId: "remote:beta" });
    term.input.write("r"); complete({ ...input, repos: [...input.repos].reverse() }); await wait(term, "Refreshed."); expect(term.frame()).toContain("> beta"); term.input.write("rq"); expect((await running).selectedSessionId).toBe("remote:beta");
    const home = runAppUi({ repo: "local", branch: "main", home: {} }, plainPalette, term.io); const frame = term.frame(); complete(input); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(frame); term.input.write("q"); await home;
  });
  it("refreshes all history and remembers real Home search/selection/scroll while restoring ownership and bytes", async () => {
    for (const name of [options.cwd, path.join(root, "alpha")]) { await mkdir(name, { recursive: true }); for (let n = 0; n < 3; n++) await record(name); }
    const before = await bytes(); const signals = process.listeners("SIGTERM"); const term = terminal(60, 20); const open = () => term.input.write("m" + "\u001b[B".repeat(UI_MENU.findIndex(item => item.screen === "debt")) + "\r");
    const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" }); await wait(term, "OVERVIEW"); open(); await wait(term, "RECURRING MISSES"); term.input.write("/alpha\rr"); await wait(term, "Refreshed."); expect(term.frame()).toContain("> alpha"); term.input.write("\u001b[6~"); const frame = term.frame().split("\r\n").slice(0, -1); term.input.write("q"); await wait(term, "OVERVIEW"); open(); await wait(term, "RECURRING MISSES"); expect(term.frame().split("\r\n").slice(0, -1)).toEqual(frame);
    term.input.end(); await running; expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(process.listeners("SIGTERM")).toEqual(signals); expect(await bytes()).toEqual(before);
  });
});
