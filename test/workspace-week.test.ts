import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { runUi, type UiTerminal } from "../src/commands/ui.js";
import { loadWeekUi } from "../src/commands/week-ui.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import { renderWeekUi, WEEK_WINDOWS } from "../src/render/tui/week.js";
import { appendSession, resolveStoreFile, zeroCost, type IntentSource, type Session } from "../src/store.js";

function session(id: string, source: IntentSource = "declared", outcome: Session["outcome"] = "merged"): Session {
  return { id, repo: "path:/example", intent: id, intentSource: source, scope: source === "captured" ? [] : ["src"],
    baseline: [], reality: outcome === "empty" ? [] : ["src/a.ts"], drift: [], cost: zeroCost(), outcome,
    startCommit: "base", startedAt: "2026-09-30T12:00:00Z", endedAt: outcome === "open" ? null : "2026-09-30T13:00:00Z",
    ...(source === "primed" ? { proposal: { rule: "declared-drift-v1" as const, intent: id, scope: ["src"], candidates: [], history: 0, comparable: 0, tracked: 1, omitted: 0 } } : {}) };
}
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw }); Object.assign(output, { isTTY: true, columns: 110, rows: 32 });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, raw, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const data = (days = 7, sessions = [session("keep this work")]) => ({ days, sessions, repo: "example", rates: new Map() });
const browser = { returnToHome: true, render: renderWeekUi, windows: WEEK_WINDOWS };
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
let root: string; let cwd: string; let home: string;
const options = () => ({ cwd, home, adapters: [] });
const record = (intent: string, days: number, source: IntentSource = "declared") => {
  const time = new Date(Date.now() - days * 86_400_000).toISOString();
  return appendSession({ intent, intentSource: source, startCommit: "base", startedAt: time, endedAt: time,
    ...(source === "primed" ? { proposal: { rule: "declared-drift-v1" as const, intent, scope: [], candidates: [], history: 0, comparable: 0, tracked: 0, omitted: 0 } } : {}) }, options());
};
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-workspace-week-")); cwd = path.join(root, "repo"); home = path.join(root, "store"); await mkdir(cwd); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("Week inside the workspace", () => {
  it("loads resolved outcomes in canonical source order, newest first, without writing", async () => {
    await record("old declaration", 20); await record("primed work", 3, "primed"); await record("older prompt", 2, "captured");
    await record("recent declaration", 1); await record("recent prompt", 0, "captured");
    const file = await resolveStoreFile(options()); const before = await readFile(file); const week = await loadWeekUi(undefined, options());
    expect(week.days).toBe(7); expect(week.sessions.map(row => row.intent)).toEqual(["recent declaration", "primed work", "recent prompt", "older prompt"]);
    expect(week.sessions.every(row => row.outcome === "empty")).toBe(true);
    expect((await loadWeekUi(30, options())).sessions.map(row => row.intent)).toEqual(["recent declaration", "old declaration", "primed work", "recent prompt", "older prompt"]);
    expect(await readFile(file)).toEqual(before);
  });
  it("keeps source summaries separate and empty sources reachable before a captured entry", () => {
    for (const sessions of [[session("declared work"), session("primed work", "primed", "open"), session("captured work", "captured", "empty")], [session("captured work", "captured", "empty")]]) {
      const state = { ...initialState(), expanded: false }; const top = renderWeekUi(data(7, sessions), state, 80, 24);
      const pages = Array.from({ length: top.maxScroll + 1 }, (_, scroll) => renderWeekUi(data(7, sessions), { ...state, scroll }, 80, 24).lines.join("\n")).join("\n");
      expect(pages).toContain(sessions.length === 1 ? "declared · no sessions" : "declared · 1 session");
      expect(pages).toContain(sessions.length === 1 ? "primed · no sessions" : "primed · 1 session"); expect(pages).toContain("captured · 1 session");
      expect(pages).not.toContain("3 sessions ·");
    }
  });
  it("bounds the Week viewport at 60×20 and keeps plain and coloured geometry identical", () => {
    const queries = ["", "source:captured outside:yes outcome:merged", "source:declared source:primed source:captured outside:yes outside:no outcome:open outcome:merged outcome:abandoned outcome:empty"];
    for (const sessions of [[], [session("a long goal ".repeat(30), "captured", "empty")]]) for (const query of queries) {
      const input = data(7, sessions); const state = { ...initialState(), query }; const plain = renderWeekUi(input, state, 60, 20).lines;
      const coloured = renderWeekUi(input, state, 60, 20, ansiPalette, "", uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines;
      expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true);
      expect(coloured.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).toContain("[w]");
    }
  });
  it("cycles ranges, preserves a surviving selected ID, and falls back when it disappears", async () => {
    const term = terminal(); const refresh = vi.fn(async (days?: number) => data(days, days === 14 ? [session("new work"), session("keep this work")] : days === 30 ? [session("new work")] : [session("keep this work")]));
    const running = runUi(data(), refresh, plainPalette, term.io, { ...browser, state: { ...initialState(), scroll: 10 } });
    term.input.write("w"); await wait(term, "last 14 days"); expect(term.frame()).toContain("> keep this work");
    term.input.write("w"); await wait(term, "last 30 days"); expect(term.frame()).toContain("> new work");
    term.input.write("w"); await wait(term, "last 7 days"); term.input.write("q"); const result = await running;
    expect(refresh.mock.calls.map(call => call[0])).toEqual([14, 30, 7]); expect(result).toMatchObject({ days: 7, selectedSessionId: "keep this work", state: { selected: 0, scroll: 0 } });
  });
  it("retains the current range and data when a new range fails, then retries that range", async () => {
    const term = terminal(); const refresh = vi.fn().mockRejectedValueOnce(new Error("unreadable record")).mockResolvedValueOnce(data(14));
    const running = runUi(data(), refresh, plainPalette, term.io, browser); term.input.write("w"); await wait(term, "unreadable record");
    expect(term.frame()).toContain("last 7 days"); expect(term.frame()).toContain("keep this work"); expect(term.frame()).toContain("w");
    term.input.write("w"); await wait(term, "last 14 days"); term.input.write("q"); expect((await running).days).toBe(14);
    expect(refresh.mock.calls.map(call => call[0])).toEqual([14, 14]);
  });
  it("types w into search and ignores range shortcuts in Help or with Ctrl", async () => {
    const term = terminal(); const refresh = vi.fn(async () => data()); const running = runUi(data(), refresh, plainPalette, term.io, browser);
    term.input.write("/w\r"); expect(term.frame()).toContain("│ > w"); expect(term.frame()).toContain("last 7 days"); term.input.emit("keypress", "", { name: "escape" });
    term.input.write("?w"); term.input.emit("keypress", "", { name: "escape" }); term.input.emit("keypress", "", { name: "w", ctrl: true }); expect(refresh).not.toHaveBeenCalled();
    term.input.write("q"); expect((await running).state.query).toBe("");
  });
  it("cannot repaint Home when a pending range finishes after Back", async () => {
    const term = terminal(); let finishRange!: (value: ReturnType<typeof data>) => void;
    const running = runUi(data(), () => new Promise(resolve => { finishRange = resolve; }), plainPalette, term.io, browser);
    term.input.write("wq"); expect((await running).days).toBe(7); const atHome = runAppUi({ repo: "example", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame();
    finishRange(data(14)); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(before); term.input.write("q"); await atHome;
  });
  it("remembers Week range, filters, selection and scroll through Home without writing", async () => {
    await record("older declared goal ".repeat(50), 10); await record("recent declared goal", 1);
    const file = await resolveStoreFile(options()); const beforeStore = await readFile(file); const term = terminal();
    const running = buildProgram({ ...options(), appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
    const menuWeek = () => term.input.write("m\u001b[B\u001b[B\u001b[B\r");
    const stableFrame = () => term.frame().split("\r\n").filter(line => !/Refreshed\.|Session \d+\//u.test(line)).join("\r\n");
    await wait(term, "OVERVIEW"); menuWeek(); await wait(term, "last 7 days"); term.input.write("w"); await wait(term, "last 14 days");
    term.input.write("s\u001b[B\u001b[6~"); const beforeHome = stableFrame(); term.input.write("q"); await wait(term, "OVERVIEW");
    menuWeek(); await wait(term, "last 14 days"); expect(stableFrame()).toBe(beforeHome);
    term.input.write("q"); await wait(term, "OVERVIEW"); term.input.write("q"); await running; expect(await readFile(file)).toEqual(beforeStore);
  });
});
