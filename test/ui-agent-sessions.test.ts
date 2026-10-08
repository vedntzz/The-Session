import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentBlocks } from "../src/agents-report.js";
import { agentSessionsOf } from "../src/agent-sessions.js";
import { agentsOf } from "../src/agents.js";
import * as agentsUi from "../src/commands/agents-ui.js";
import { loadAgentsUi, type AgentsWorkspaceData } from "../src/commands/agents-ui.js";
import { agentSessions } from "../src/commands/agents.js";
import { runAgentsUi } from "../src/commands/agents-browser-ui.js";
import { runUiBrowser, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { UI_MENU } from "../src/render/tui/menu.js";
import { agentEvidenceLines } from "../src/render/tui/agent-evidence.js";
import { navigateAgentSessions, renderAgentSessionsUi, selectAgentSessions, visibleAgentSessions } from "../src/render/tui/agent-sessions.js";
import { AGENTS_WINDOWS, navigateAgents, renderAgentsUi, visibleAgentBlocks } from "../src/render/tui/agents.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth, safeText } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, writeRecord, zeroCost, type Session } from "../src/store.js";
import type { WriteCheckEvent } from "../src/write-check-event.js";
import { event, inputs, session } from "./fixtures/agents.js";

const NOW = Date.parse("2026-10-06T16:00:00Z");
const workspace = (sessions: Session[], checks = new Map<string, WriteCheckEvent[]>(), days?: number): AgentsWorkspaceData => ({ blocks: agentBlocks(sessions, { ...inputs(), checks }), sessionCount: sessions.length, sessions, checks, known: inputs().known, repo: "local repo", days });
const browser = { returnToHome: true, render: renderAgentSessionsUi, select: visibleAgentSessions, navigate: navigateAgentSessions, backLabel: "Tools" };
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
const compact = (text: string) => text.replace(/\s/gu, "");
const decisions: WriteCheckEvent[] = [event("claude-code", "ask"), { ...event("codex", "deny"), n: 2 }, { ...event("codex", "silent"), n: 2 }, { ...event("codex", "not-checked"), n: 3, tool: null, path: null }];
let root: string; let options: { cwd: string; home: string; adapters: never[] };
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm"); vi.spyOn(Date, "now").mockReturnValue(NOW);
  root = await mkdtemp(path.join(tmpdir(), "session-ui-agent-sessions-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function signedFixture() {
  const git = promisify(execFile); await git("git", ["init", "-q", "-b", "main", options.cwd]);
  await git("git", ["-C", options.cwd, "-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-q", "-m", "initial"]);
  const base = (await git("git", ["-C", options.cwd, "rev-parse", "HEAD"])).stdout.trim();
  const old = await appendSession({ intent: "Old goal", startCommit: base, startedAt: "2026-09-01T12:00:00Z", endedAt: "2026-09-01T13:00:00Z", cost: { ...zeroCost(), turns: 1, apiCalls: 3 } }, options);
  const recent = await appendSession({ intent: "Recent FULL goal " + "detail ".repeat(40), intentSource: "captured", startCommit: base, startedAt: "2026-10-05T12:00:00Z", endedAt: "2026-10-05T13:00:00Z", openedBy: { id: "editor-one", agent: "claude-code" }, cost: { ...zeroCost(), turns: 1, agents: ["claude-code", "codex"] } }, options);
  await writeRecord(recent.id, { agentSession: { type: "agent-start", id: "editor-two", agent: "codex" } }, options);
  await writeRecord(recent.id, { agentSession: { type: "agent-end", id: "editor-one" } }, options);
  for (const check of decisions) await writeRecord(recent.id, { writeCheck: check }, options);
  return { old, recent, ledger: await resolveStoreFile(options) };
}

describe("Recorded session coding tool activity", () => {
  it("selects whole mixed sessions and legacy membership without inferring a tool from editor bindings", () => {
    const legacy = session([], { id: "legacy" }, { agents: undefined, apiCalls: 2 }); const mixed = session(["claude-code", "codex"], { id: "mixed" });
    const unbound = session([], { id: "uncaptured", openedBy: { id: "editor", agent: "claude-code" } }, { turns: 0 }); const literalNull = session(["null"], { id: "literal-null" }); const input = workspace([legacy, mixed, unbound, literalNull]);
    for (const agent of ["claude-code", "codex", "null", null]) {
      const selected = selectAgentSessions(input, agent); const expected = input.sessions.filter(record => agent === null ? agentsOf(record.cost, input.known).length === 0 : agentsOf(record.cost, input.known).includes(agent));
      expect(new Set(selected.sessions.map(record => record.id))).toEqual(new Set(expected.map(record => record.id))); for (const record of selected.sessions) expect(record.cost).toEqual(input.sessions.find(row => row.id === record.id)!.cost);
    }
    expect(selectAgentSessions(input, "claude-code").sessions.map(record => record.id)).not.toContain("uncaptured"); expect(selectAgentSessions(input, null).sessions.map(record => record.id)).toEqual(["uncaptured"]);
  });
  it("transcribes native editor states and every recorded decision in order without deduplicating, granting or verifying", () => {
    const record = session(["claude-code", "codex"], { openedBy: { id: "editor-one", agent: "claude-code" }, agentEvents: [{ type: "agent-start", id: "editor-two" }, { type: "agent-end", id: "editor-one", agent: "codex" }] });
    const lines = agentEvidenceLines(record, decisions, inputs().known); const text = lines.join("\n");
    for (const binding of agentSessionsOf(record)) { expect(text).toContain(`${binding.id} · ${binding.agent ?? "tool not recorded"}`); expect(text).toContain(binding.live ? "live on record; no end recorded" : "ended"); }
    expect(lines.filter(line => line.startsWith("#"))).toEqual(["#1 · claude-code · ask · approval requested", "#2 · codex · deny · check refused the write", "#2 · codex · silent · no objection; editor permissions still apply", "#3 · codex · not-checked · check did not finish"]);
    expect(text).toContain("Tool: not recorded · Path: not resolved"); expect(text).toContain("Recorded decisions, not completed writes"); expect(text).toContain("Signatures are not verified"); expect(text).not.toMatch(/\ballow\b|write succeeded|signatures verified/u);
  });
  it("keeps missing checks, missing capture and Codex calls unknown while retaining a measured zero", () => {
    for (const record of [session(["claude-code"], {}, { turns: 0, apiCalls: 99 }), session(["codex"], {}, { apiCalls: 0 }), session(["claude-code", "codex"])]) {
      const text = agentEvidenceLines(record, [], inputs().known).join("\n"); expect(text).toContain("Session API calls: not counted"); expect(text).toContain("asks and denials are unknown"); expect(text).not.toMatch(/0 asks|0 denials|\$|empty turns/u);
    }
    expect(agentEvidenceLines(session(["claude-code"], {}, { apiCalls: 0 }), [], inputs().known)).toContain("Session API calls: 0"); expect(agentEvidenceLines(session([]), [], inputs().known).join("\n")).toContain("No editor session IDs recorded");
  });
  it("searches full literal goals, IDs, binding names and check paths/reasons, with honest empty states and source/outcome detail", () => {
    const record = session(["claude-code", "codex"], { id: "full-session-ID", intent: "Fix RÉSUMÉ 修复 COMPLETE", intentSource: "captured", endedAt: null }); const checks = [{ ...decisions[0]!, path: "src/unique.ts", reason: "outside-paths" }]; const input = selectAgentSessions(workspace([record], new Map([[record.id, checks]])), "codex");
    for (const query of ["RÉSUMÉ 修复", "full-session-id COMPLETE", "codex unique.ts outside-paths"]) expect(visibleAgentSessions(input, { ...initialState(), query })).toEqual([record]);
    expect(visibleAgentSessions(input, { ...initialState(), query: "source:captured" })).toEqual([]); const text = renderAgentSessionsUi(input, initialState(), 140, 100).lines.join("\n"); for (const value of [record.id, record.intent!, "open · captured", "still running", "#1 · claude-code"]) expect(text).toContain(value);
    expect(renderAgentSessionsUi(input, { ...initialState(), query: "missing" }, 60, 20).lines.join("\n")).toContain("No matches"); expect(renderAgentSessionsUi(selectAgentSessions(workspace([]), null), initialState(), 60, 20).lines.join("\n")).toContain("No recorded sessions for this tool");
  });
  it("keeps history shortcuts inert, preserves search text and allows normal expansion and Ctrl paging", () => {
    const state = { ...initialState(), expanded: false, scroll: 8 }; for (const name of ["o", "s", "d", "e"]) expect(navigateAgentSessions(state, { name }, 1, 20)).toEqual(state); expect(navigateAgentSessions(state, { name: "e", ctrl: true }, 1, 20)).toEqual(state);
    expect(navigateAgentSessions(state, { name: "d", ctrl: true }, 1, 20).scroll).toBe(13); expect(navigateAgentSessions({ ...state, searching: true }, { sequence: "osedqr" }, 1, 20).query).toBe("osedqr"); expect(navigateAgentSessions(state, { name: "return" }, 1, 20).expanded).toBe(true);
  });
  it("keeps full hostile goals, bindings and paths reachable with actual five-line paging and plain/colour 60×20 parity", async () => {
    const goal = "Fix RÉSUMÉ 修复 e\u0301\u001b[2J\n" + Array.from({ length: 25 }, (_, n) => `Goal ${n}: retain full detail.`).join(" "); const boundId = "editor-" + "long-ID-".repeat(12); const checkPath = "src/" + "long-directory/".repeat(18) + "FINAL.ts";
    const record = session(["claude-code", "codex"], { id: "full-session-identifier", intent: goal, openedBy: { id: boundId, agent: "codex" } }); const checks = decisions.map(check => ({ ...check, path: check.path === null ? null : checkPath })); const input = selectAgentSessions(workspace([record], new Map([[record.id, checks]])), "codex"); const notice = "/unreadable directory/".repeat(20);
    for (const help of [false, true]) for (const status of ["", notice]) { const plain = renderAgentSessionsUi(input, { ...initialState(), help }, 60, 20, plainPalette, status).lines; const colour = renderAgentSessionsUi(input, { ...initialState(), help }, 60, 20, ansiPalette, status, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines; expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).not.toContain("\u001b"); }
    const maxScroll = renderAgentSessionsUi(input, initialState(), 60, 20).maxScroll; const term = terminal(60, 20); const running = runUiBrowser(input, async () => input, plainPalette, term.io, browser); const body: string[] = []; let scroll = 0;
    for (let page = 0; page < 100; page++) { const lines = term.frame().split("\r\n"); const visible = lines.slice(lines.findIndex(line => line.includes("Checks record decisions")) + 1, lines.findLastIndex(line => /^─+$/u.test(line.trim()))); const next = Math.min(maxScroll, scroll + 5); body.push(...(next === scroll ? visible : visible.slice(0, next - scroll))); if (next === scroll) break; term.input.write("\u001b[6~"); await new Promise(resolve => setImmediate(resolve)); scroll = next; }
    const text = compact(body.join("")); for (const value of [safeText(goal), boundId, checkPath, ...agentEvidenceLines(record, checks, input.known)]) expect(text).toContain(compact(safeText(value))); term.input.write("q"); await running;
  });
  it("opens a child only from a selected tool outside search, Help, Ctrl, paste, resize restrictions and refresh", async () => {
    const input = workspace([session(["claude-code"])]); let complete!: (data: AgentsWorkspaceData) => void; const refresh = vi.fn(() => new Promise<AgentsWorkspaceData>(resolve => { complete = resolve; })); const term = terminal(); const running = runUiBrowser(input, refresh, plainPalette, term.io, { returnToHome: true, render: renderAgentsUi, select: visibleAgentBlocks, navigate: navigateAgents, windows: AGENTS_WINDOWS, openKey: "s" });
    term.input.emit("keypress", "", { name: "s", ctrl: true }); term.input.write("?s?\u001b[200~s\u001b[201~"); term.input.write("/s"); expect(term.frame()).toContain("> s"); term.input.emit("keypress", "", { name: "escape" }); term.input.write("/missing\r"); term.input.write("s"); expect(term.frame()).toContain("No matching coding tools"); term.input.emit("keypress", "", { name: "escape" });
    Object.assign(term.output, { columns: 59, rows: 19 }); term.output.emit("resize"); term.input.write("s"); expect(term.input.listenerCount("keypress")).toBe(1); Object.assign(term.output, { columns: 110, rows: 40 }); term.output.emit("resize"); term.input.write("rs"); expect(refresh).toHaveBeenCalledTimes(1); complete(input); await wait(term, "Refreshed."); term.input.write("s"); expect(await running).toMatchObject({ opened: true, exitWorkspace: false, selectedSessionId: JSON.stringify("claude-code") }); expect(term.input.listenerCount("keypress")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false);
  });
  it("keeps the parent range and data unchanged when a child refresh completes after Back", async () => {
    const input = workspace([session(["claude-code"], { intent: "BEFORE CLOSE" })], undefined, 7); let complete!: (data: AgentsWorkspaceData) => void; const load = vi.spyOn(agentsUi, "loadAgentsUi").mockResolvedValueOnce(input).mockImplementation(() => new Promise(resolve => { complete = resolve; })); const term = terminal(); const saved = { state: initialState(), days: 7, exitWorkspace: false, sessionsByTool: new Map() }; const running = runAgentsUi(options, plainPalette, term.io, saved);
    await wait(term, "CODING TOOL ACTIVITY"); term.input.write("s"); await wait(term, "TOOL SESSIONS"); term.input.write("rq"); await wait(term, "CODING TOOL ACTIVITY"); expect(load).toHaveBeenLastCalledWith(7, options); const frame = term.frame(); complete(workspace([session(["claude-code"], { intent: "AFTER CLOSE" })], undefined, 7)); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(frame); term.input.write("s"); await wait(term, "TOOL SESSIONS"); expect(term.frame()).toContain("BEFORE CLOSE"); expect(term.frame()).not.toContain("AFTER CLOSE"); term.input.write("q"); await wait(term, "CODING TOOL ACTIVITY"); term.input.write("q"); await running;
  });
  it("loads exact native sessions, bindings and check order without modifying the signed ledger", async () => {
    const fixture = await signedFixture(); const before = await readFile(fixture.ledger); const loaded = await loadAgentsUi(undefined, options); const native = await agentSessions(undefined, options); expect(loaded.sessions).toEqual(native.sessions); expect(loaded.checks).toEqual(native.checks); expect(loaded.checks.get(fixture.recent.id)).toEqual(decisions);
    expect(agentSessionsOf(loaded.sessions.find(record => record.id === fixture.recent.id)!)).toEqual([{ id: "editor-one", agent: "claude-code", live: false }, { id: "editor-two", agent: "codex", live: true }]); expect((await loadAgentsUi(7, options)).sessions.map(record => record.id)).toEqual([fixture.recent.id]); expect(await readFile(fixture.ledger)).toEqual(before);
  });
  it("preserves separate child searches and paging through Tools and real Home, with the parent range and terminal cleanup intact", async () => {
    const fixture = await signedFixture(); const before = await readFile(fixture.ledger); const signals = process.listeners("SIGTERM"); const term = terminal(60, 20); const open = () => term.input.write("m" + "\u001b[B".repeat(UI_MENU.findIndex(item => item.screen === "agents")) + "\r"); const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
    await wait(term, "OVERVIEW"); open(); await wait(term, "CODING TOOL ACTIVITY"); term.input.write("w"); await wait(term, "Refreshed."); term.input.write("s"); await wait(term, "TOOL SESSIONS"); term.input.write("/Recent\r\u001b[6~"); const claudeFrame = term.frame().split("\r\n").slice(0, -1); term.input.write("q"); await wait(term, "CODING TOOL ACTIVITY"); term.input.write("\u001b[Bs"); await wait(term, "TOOL SESSIONS"); term.input.write("/editor-two\r\u001b[6~"); const codexFrame = term.frame().split("\r\n").slice(0, -1);
    term.input.write("q"); await wait(term, "CODING TOOL ACTIVITY"); term.input.write("q"); await wait(term, "OVERVIEW"); open(); await wait(term, "CODING TOOL ACTIVITY"); expect(term.frame()).toContain("last 7 days"); term.input.write("s"); await wait(term, "TOOL SESSIONS"); expect(term.frame().split("\r\n").slice(0, -1)).toEqual(codexFrame); term.input.write("q"); await wait(term, "CODING TOOL ACTIVITY"); term.input.write("\u001b[As"); await wait(term, "TOOL SESSIONS"); expect(term.frame().split("\r\n").slice(0, -1)).toEqual(claudeFrame);
    term.input.end(); await running; expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(process.listeners("SIGTERM")).toEqual(signals); expect(await readFile(fixture.ledger)).toEqual(before);
  });
});
