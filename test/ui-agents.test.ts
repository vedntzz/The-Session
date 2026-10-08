import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentBlocks } from "../src/agents-report.js";
import { knownAgents } from "../src/capture/index.js";
import { agentSessions } from "../src/commands/agents.js";
import { loadAgentsUi } from "../src/commands/agents-ui.js";
import { runAppUi } from "../src/commands/app-ui.js";
import * as sweep from "../src/commands/sweep.js";
import { runUiBrowser, type UiTerminal } from "../src/commands/ui.js";
import { loadRates } from "../src/pricing.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { landed, spent, survived, writes } from "../src/render/terminal/agents.js";
import { AGENTS_WINDOWS, navigateAgents, renderAgentsUi, visibleAgentBlocks, type AgentsUiData } from "../src/render/tui/agents.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth, safeText } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, writeRecord, zeroCost, type Session } from "../src/store.js";
import { event, inputs, merged, session } from "./fixtures/agents.js";

const NOW = Date.parse("2026-10-06T16:00:00Z");
const data = (sessions: Session[] = [], days?: number): AgentsUiData => ({ blocks: agentBlocks(sessions, inputs()), sessionCount: sessions.length, repo: "local repo", days });
const browser = { returnToHome: true, render: renderAgentsUi, select: visibleAgentBlocks, navigate: navigateAgents, windows: AGENTS_WINDOWS };
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
const compact = (text: string) => text.replace(/\s/gu, "");
const rendered = (input: AgentsUiData, selected = 0) => renderAgentsUi(input, { ...initialState(), selected }, 140, 200).lines.join("\n");
let root: string; let options: { cwd: string; home: string; adapters: never[] };
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm"); vi.spyOn(Date, "now").mockReturnValue(NOW);
  root = await mkdtemp(path.join(tmpdir(), "session-ui-agents-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function signedFixture() {
  const git = promisify(execFile); await git("git", ["init", "-q", "-b", "main", options.cwd]);
  await git("git", ["-C", options.cwd, "-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-q", "-m", "initial"]);
  const base = (await git("git", ["-C", options.cwd, "rev-parse", "HEAD"])).stdout.trim();
  const older = await appendSession({ intent: "old declaration", startCommit: base, startedAt: "2026-09-01T12:00:00Z", endedAt: "2026-09-01T13:00:00Z", cost: { ...zeroCost(), turns: 1, apiCalls: 3, model: "claude-opus-4-1" } }, options);
  const recent = await appendSession({ intent: "captured prompt", intentSource: "captured", startCommit: base, startedAt: "2026-10-05T12:00:00Z", endedAt: "2026-10-05T13:00:00Z", cost: { ...zeroCost(), turns: 1, agents: ["claude-code", "codex"], model: "unknown-model" } }, options);
  await writeRecord(recent.id, { writeCheck: event("claude-code", "ask") }, options);
  await writeRecord(recent.id, { writeCheck: { ...event("codex", "deny"), n: 2 } }, options);
  return { older, recent, ledger: await resolveStoreFile(options) };
}

describe("Coding tool activity workspace", () => {
  it("loads native outcomes, legacy adapter attribution and signed checks without sweeping or modifying files", async () => {
    const fixture = await signedFixture(); const before = await readFile(fixture.ledger); const names = await readdir(options.home); const swept = vi.spyOn(sweep, "sweepFirst");
    const loaded = await loadAgentsUi(undefined, options); const native = await agentSessions(undefined, options); const rates = await loadRates(options.home);
    expect(loaded.blocks).toEqual(agentBlocks(native.sessions, { known: knownAgents(), checks: native.checks, rates, now: NOW })); expect(loaded.sessionCount).toBe(2);
    const tool = (name: string, source: string) => loaded.blocks.find(block => block.agent === name)!.rows.find(row => row.source === source)!;
    expect(tool("claude-code", "declared").sessions).toBe(1); expect(tool("claude-code", "captured").writes).toEqual({ asked: 1, denied: 0 }); expect(tool("codex", "captured").writes).toEqual({ asked: 0, denied: 1 });
    expect((await loadAgentsUi(7, options)).sessionCount).toBe(1); await expect(loadAgentsUi(0, options)).rejects.toThrow("whole number");
    expect(swept).not.toHaveBeenCalled(); expect(await readFile(fixture.ledger)).toEqual(before); expect(await readdir(options.home)).toEqual(names);
  });
  it("keeps all three source blocks and whole mixed sessions separate, using exact native measurements", () => {
    const input = data([session(["claude-code", "codex"]), session(["claude-code"], { intentSource: "primed" }), session(["claude-code"], { intentSource: "captured" }, { model: "future-model" })]);
    for (const [index, block] of input.blocks.entries()) {
      const text = compact(rendered(input, index)); expect(block.rows.map(row => row.source)).toEqual(["declared", "primed", "captured"]);
      for (const row of block.rows.filter(row => row.sessions)) for (const value of [landed(row), survived(row), writes(row), spent(row, true)]) expect(text).toContain(compact(value));
    }
    expect(input.blocks.every(block => block.rows[0]!.mixed === 1)).toBe(true); const codex = rendered(input, 1); expect(codex).toContain("— api calls"); expect(codex).not.toContain("0 api calls"); expect(rendered(input)).toContain("future-model");
  });
  it("keeps an uncaptured block distinct from a literal null tool name and never invents zero calls, writes or cost", () => {
    const input = data([session([], {}, { turns: 0, apiCalls: 0 }), session(["null"])]); const rows = visibleAgentBlocks(input, initialState()); expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    const index = rows.findIndex(row => row.agent === null); const text = rendered(input, index); expect(text).toContain("no agent captured"); expect(text).toContain("1 uncaptured"); expect(text).not.toMatch(/\$0\.00|0 api calls|0 asked|0 denied/u);
  });
  it("shows survival counts and pending work without a rate below five checked sessions", () => {
    const input = data([...Array.from({ length: 4 }, () => merged(["claude-code"], 40, true)), merged(["claude-code"], 3)]); const text = rendered(input);
    expect(text).toContain("5 merged"); expect(text).toContain("4 checked, too few for a rate · 1 pending"); expect(text).not.toMatch(/\d+%/u);
  });
  it("searches tool names case-insensitively and shows selected, empty and no-match content on the first minimum-size frame", () => {
    const input = data([session(["Résumé 修复"])]); expect(visibleAgentBlocks(input, { ...initialState(), query: "RÉSUMÉ 修复" }).map(row => row.agent)).toEqual(["Résumé 修复"]);
    expect(renderAgentsUi(input, initialState(), 60, 20).lines.join("\n")).toContain("> claude-code"); expect(renderAgentsUi(data(), initialState(), 60, 20).lines.join("\n")).toContain("No recorded sessions");
    expect(renderAgentsUi(input, { ...initialState(), query: "missing" }, 60, 20).lines.join("\n")).toContain("No matching coding tools"); expect(rendered(data([session(["codex"])]))).toContain("1 recorded session ·");
  });
  it("disables history-only shortcuts while preserving search text, help, expansion and Ctrl paging", () => {
    const state = { ...initialState(), expanded: false, scroll: 8 }; for (const name of ["o", "s", "d", "e"]) expect(navigateAgents(state, { name }, 2, 30)).toEqual(state);
    expect(navigateAgents(state, { name: "e", ctrl: true }, 2, 30)).toEqual(state); expect(navigateAgents(state, { name: "d", ctrl: true }, 2, 30).scroll).toBe(13); expect(navigateAgents(state, { name: "u", ctrl: true }, 2, 30).scroll).toBe(3);
    expect(navigateAgents({ ...state, searching: true }, { sequence: "osedw" }, 2, 30).query).toBe("osedw"); expect(navigateAgents({ ...state, help: true }, { name: "s" }, 2, 30)).toEqual({ ...state, help: true }); expect(navigateAgents(state, { name: "return" }, 2, 30).expanded).toBe(true);
  });
  it("sanitizes long Unicode names and statuses and reaches every native detail with actual PgDown at 60×20", async () => {
    const name = "Résumé 修复 e\u0301\u001b[2J " + "Long tool ".repeat(12) + "FINAL"; const input = data([session([name], {}, { model: "future-model" })]); const selected = input.blocks.findIndex(block => block.agent === name); const state = { ...initialState(), selected }; const notice = "/saved directory/".repeat(20);
    for (const help of [false, true]) for (const status of ["", notice]) { const plain = renderAgentsUi(input, { ...state, help }, 60, 20, plainPalette, status).lines; const colour = renderAgentsUi(input, { ...state, help }, 60, 20, ansiPalette, status, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines; expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).not.toContain("\u001b"); }
    const term = terminal(60, 20); const running = runUiBrowser(input, async () => input, plainPalette, term.io, { ...browser, state }); const pages: string[] = [];
    for (let page = 0; page < 100; page++) { const frame = term.frame(); const lines = frame.split("\r\n"); pages.push(lines.slice(lines.findIndex(line => line.includes("Separate tools")) + 1, lines.findLastIndex(line => /^─+$/u.test(line.trim()))).join("")); term.input.write("\u001b[6~"); await new Promise(resolve => setImmediate(resolve)); if (term.frame() === frame) break; }
    const text = compact(pages.join("")); const row = input.blocks[selected]!.rows[0]!; for (const value of [safeText(name), landed(row), survived(row), writes(row), spent(row, true), "primed · no sessions", "captured · no sessions", "never pooled"]) expect(text).toContain(compact(value)); term.input.write("q"); await running;
  });
  it("cycles all history through 7/14/30 and back to explicit undefined, retaining a surviving row after refresh", async () => {
    const input = data([session(["claude-code"])]); const refresh = vi.fn(async (days?: number) => ({ ...input, days, blocks: [...input.blocks].reverse() })); const term = terminal(); const running = runUiBrowser(input, refresh, plainPalette, term.io, browser);
    term.input.emit("keypress", "", { name: "w", ctrl: true }); term.input.write("?w?"); expect(refresh).not.toHaveBeenCalled();
    term.input.write("/w"); expect(term.frame()).toContain("> w"); expect(refresh).not.toHaveBeenCalled(); term.input.emit("keypress", "", { name: "escape" });
    for (const days of [7, 14, 30, undefined]) { term.input.write("w"); await wait(term, "Refreshed."); expect(refresh).toHaveBeenLastCalledWith(days); expect(term.frame()).toContain("> claude-code"); }
    term.input.write("r"); await wait(term, "Refreshed."); expect(refresh).toHaveBeenLastCalledWith(undefined); term.input.write("q"); expect(await running).toMatchObject({ days: undefined, selectedSessionId: JSON.stringify("claude-code"), exitWorkspace: false });
  });
  it("retains the all-history range after a failed reload and cannot repaint Home after late completion", async () => {
    let complete!: (input: AgentsUiData) => void; const input = data(); const refresh = vi.fn<(days?: number) => Promise<AgentsUiData>>().mockRejectedValueOnce(new Error("unreadable records")).mockImplementation(() => new Promise(resolve => { complete = resolve; })); const term = terminal(); const running = runUiBrowser(input, refresh, plainPalette, term.io, browser);
    term.input.write("w"); await wait(term, "Refresh failed"); expect(term.frame()).toContain("all recorded history"); term.input.write("wq"); expect((await running).days).toBeUndefined(); const home = runAppUi({ repo: "app", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame(); complete(data([], 7)); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(before); term.input.write("q"); await home;
  });
  it("remembers the real workspace range, search, tool and scroll through Home, restoring terminal ownership without ledger writes", async () => {
    const fixture = await signedFixture(); const before = await readFile(fixture.ledger); const signals = process.listeners("SIGTERM"); const term = terminal(60, 20); const open = () => term.input.write("m" + "\u001b[B".repeat(8) + "\r");
    const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" }); await wait(term, "OVERVIEW"); open(); await wait(term, "CODING TOOL ACTIVITY"); term.input.write("w"); await wait(term, "Refreshed."); term.input.write("/CODEX\r\u001b[6~"); const frame = term.frame().split("\r\n").slice(0, -1); term.input.write("q"); await wait(term, "OVERVIEW"); open(); await wait(term, "CODING TOOL ACTIVITY"); expect(term.frame().split("\r\n").slice(0, -1)).toEqual(frame);
    term.input.end(); await running; expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(process.listeners("SIGTERM")).toEqual(signals); expect(await readFile(fixture.ledger)).toEqual(before);
  });
});
