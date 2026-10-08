import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as observe from "../src/observe.js";
import * as sweep from "../src/commands/sweep.js";
import * as store from "../src/store.js";
import { runAppUi } from "../src/commands/app-ui.js";
import { scanSessions } from "../src/commands/scan.js";
import { loadScanUi } from "../src/commands/scan-ui.js";
import { runUiBrowser, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { UI_MENU } from "../src/render/tui/menu.js";
import { navigateScan, renderScanUi, SCAN_WINDOWS, scanQuery, visibleScanned, type ScanUiData } from "../src/render/tui/scan.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import type { ScannedSession } from "../src/scan.js";

const scanned = (extra: Partial<ScannedSession> = {}): ScannedSession => ({ id: "local-row", repo: "/workspace/app", label: "Fix RÉSUMÉ 修复", startedAt: "2026-10-05T12:00:00Z", endedAt: "2026-10-05T13:00:00Z", cost: { ...store.zeroCost(), turns: 1, inputTokens: 20, model: "future-model", emptyTurns: 99 }, ...extra });
const data = (sessions = [scanned()], days = 30): ScanUiData => ({ sessions, days, rates: new Map(), repo: "app", root: "/transcripts", present: true, currentRepos: ["/workspace/app", "/workspace/alias"] });
const browser = { returnToHome: true, render: renderScanUi, select: visibleScanned, navigate: navigateScan, windows: SCAN_WINDOWS, refreshNotice: "Reading local transcripts…" };
function terminal(columns = 110, rows = 32) {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); }); return { input, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
function allBody(input: ScanUiData, state = initialState()): string {
  const top = renderScanUi(input, state, 60, 20); const start = top.lines.findIndex(line => line.includes("First prompts")) + 1; const end = top.lines.findLastIndex(line => /^─+$/u.test(line.trim()));
  const pages = Array.from({ length: top.maxScroll + 1 }, (_, scroll) => renderScanUi(input, { ...state, scroll }, 60, 20).lines); return [...pages.map(lines => lines[start]!), ...pages.at(-1)!.slice(start + 1, end)].join("").replace(/\s/gu, "");
}
let root: string; let options: { cwd: string; home: string; root: string; now: () => Date; adapters: never[] }; const exitCode = process.exitCode;
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-ui-scan-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), root: path.join(root, "projects"), now: () => new Date("2026-10-06T16:00:00Z"), adapters: [] }; await mkdir(options.cwd); await mkdir(options.root); });
afterEach(async () => { process.exitCode = exitCode; vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function transcript(id: string, cwd: string, label: string, at = "2026-10-05T12:00:00Z"): Promise<string> {
  const directory = path.join(options.root, "project"); await mkdir(directory, { recursive: true }); const file = path.join(directory, id + ".jsonl"); await writeFile(file, [
    JSON.stringify({ type: "user", timestamp: at, cwd, message: { role: "user", content: label } }),
    JSON.stringify({ type: "assistant", timestamp: at, cwd, requestId: id, message: { role: "assistant", model: "future-model", content: [{ type: "text", text: "reply" }], usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
  ].join("\n") + "\n"); return file;
}

describe("Native scanned-session workspace", () => {
  it("loads native newest-first rows with checkout aliases, without reading signed sessions, sweeping, resolving outcomes or writing", async () => {
    await promisify(execFile)("git", ["init", "-b", "main"], { cwd: options.cwd }); await mkdir(path.join(options.cwd, "sub")); const alias = path.join(root, "alias"); await symlink(options.cwd, alias);
    const file = await transcript("recent", path.join(alias, "sub"), "Native first prompt"); await transcript("older", options.cwd, "Older first prompt", "2026-09-20T12:00:00Z"); const before = await readFile(file); const read = vi.spyOn(store, "readSessions"); const walk = vi.spyOn(observe, "withOutcomes"); const swept = vi.spyOn(sweep, "sweepFirst");
    const loaded = await loadScanUi(30, { ...options, cwd: path.join(alias, "sub") }); const native = await scanSessions(30, loaded.rates, options); expect(loaded.sessions).toEqual([...native.sessions].reverse()); expect(loaded.sessions.map(row => row.id)).toEqual(["recent", "older"]); expect(loaded.currentRepos).toContain(await realpath(options.cwd)); expect(visibleScanned(loaded, { ...initialState(), query: "repo:current" })).toHaveLength(2);
    expect(loaded.present).toBe(true); for (const field of ["intent", "outcome", "scope", "reality", "drift"]) expect(loaded.sessions[0]).not.toHaveProperty(field); expect(read).not.toHaveBeenCalled(); expect(walk).not.toHaveBeenCalled(); expect(swept).not.toHaveBeenCalled(); expect(await readFile(file)).toEqual(before); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("matches current directories at path boundaries, excludes unknown directories and combines Unicode text, ID and repository filters", () => {
    const input = data([scanned(), scanned({ id: "child", repo: "/workspace/app/sub" }), scanned({ id: "alias", repo: "/workspace/alias" }), scanned({ id: "sibling", repo: "/workspace/app-other" }), scanned({ id: "unknown", repo: "" })]); const rows = (query: string) => visibleScanned(input, { ...initialState(), query }).map(row => row.id);
    expect(rows("repo:current")).toEqual(["local-row", "child", "alias"]); expect(rows("repo:unknown")).toEqual(["unknown"]); expect(rows("repo:all")).toHaveLength(5); expect(rows("RÉSUMÉ 修复 child repo:CURRENT")).toEqual(["child"]); expect(rows("app-other repo:all")).toEqual(["sibling"]);
    for (const query of ["repo:other", "repo:", "repo:all repo:current", "repo:unknown repo:current"]) { expect(scanQuery(query).error).toBeDefined(); expect(rows(query)).toEqual([]); } expect(rows("repo:current repo:current")).toEqual(["local-row", "child", "alias"]);
  });
  it("cycles project tokens without history filters and retains ordinary letters while searching or in Help", () => {
    let state = { ...initialState(), query: "Fix RÉSUMÉ repo:ALL", selected: 2, scroll: 7 }; for (const key of ["o", "s", "d", "e"]) expect(navigateScan(state, { name: key }, 3, 20)).toEqual(state); const collapsed = { ...state, expanded: false }; expect(navigateScan(collapsed, { name: "e", ctrl: true }, 3, 20)).toEqual(collapsed);
    state = navigateScan(state, { name: "p" }, 3, 20); expect(state).toMatchObject({ query: "Fix RÉSUMÉ repo:current", selected: 0, scroll: 0, expanded: true }); state = navigateScan(state, { name: "p" }, 3, 20); expect(scanQuery(state.query).project).toBe("unknown"); state = navigateScan(state, { name: "p" }, 3, 20); expect(state.query).toBe("Fix RÉSUMÉ");
    const searching = navigateScan({ ...initialState(), searching: true, query: "" }, { sequence: "posdew" }, 3, 20); expect(searching.query).toBe("posdew"); expect(navigateScan(searching, { name: "return" }, 3, 20)).toMatchObject({ searching: false, expanded: true }); const help = { ...initialState(), help: true }; expect(navigateScan(help, { name: "p" }, 3, 20)).toEqual(help); expect(navigateScan(state, { name: "p", ctrl: true }, 3, 20).query).toBe(state.query); expect(navigateScan(state, { name: "d", ctrl: true }, 3, 20).scroll).toBe(5);
  });
  it("keeps true, false and unknown timestamp overlap distinct without outcome, drift, empty-turn or usage figures", () => {
    for (const [landed, text] of [[true, "Ran while a commit landed on the default branch"], [false, "No commit landed during the counted calls"], [undefined, "Commit overlap unknown: Git could not be asked"]] as const) {
      const rendered = renderScanUi(data([scanned({ landed })]), initialState(), 110, 60).lines.join("\n"); expect(rendered).toContain(text); expect(rendered).not.toMatch(/\bmerged\b|\bshipped\b|\$|Input tokens|Output tokens|\b\d+ turns?\b|\b\d+ (?:outside|empty)\b/u); expect(rendered).toContain("no diff recorded");
    }
  });
  it("keeps full prompts, IDs, directories and dates reachable, with escape-safe Unicode and matching 60×20 colour geometry", () => {
    const record = scanned({ id: "full-transcript-identifier-0123456789", label: "Goal\u001b[2J 修复 e\u0301\n" + "Full prompt detail ".repeat(40) + "FINAL", repo: "/workspace/" + "long-directory/".repeat(15) }); const input = data([record]); const body = allBody(input); for (const text of ["Goal 修复 e\u0301", "FINAL", record.id, record.repo, record.startedAt, record.endedAt]) expect(body).toContain(text.replace(/\s/gu, ""));
    for (const state of [initialState(), { ...initialState(), expanded: false }, { ...initialState(), help: true }, { ...initialState(), searching: true, query: "修复 e\u0301 ".repeat(60) }]) {
      const plain = renderScanUi(input, state, 60, 20).lines; const colour = renderScanUi(input, state, 60, 20, ansiPalette, "", uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines; expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).not.toContain("\u001b"); for (const key of ["w", "p"]) expect(plain.join("\n")).toContain(`[${key}]`);
    }
  });
  it("follows later selections in a restricted reader while preserving the full restriction metadata", () => {
    const restriction = "/workspace/" + "long-restriction/".repeat(15); const input = { ...data([...Array.from({ length: 20 }, (_, index) => scanned({ id: `row-${index}` })), scanned({ id: "last-row", label: "Selected final prompt" })]), restriction };
    expect(allBody(input)).toContain(restriction.replace(/\s/gu, "")); expect(renderScanUi(input, { ...initialState(), selected: 20 }, 60, 20).lines.join("\n")).toContain("last-row");
  });
  it("distinguishes absent transcripts, an empty window, filtered emptiness and invalid queries", async () => {
    const absent = await loadScanUi(30, { ...options, root: path.join(root, "missing") }); expect(absent.present).toBe(false); expect(renderScanUi(absent, initialState(), 110, 40).lines.join("\n")).toContain("No Claude Code transcripts to scan"); const empty = await loadScanUi(7, options); expect(empty.present).toBe(true); expect(renderScanUi(empty, initialState(), 110, 40).lines.join("\n")).toContain("No tool sessions in the last 7 days");
    expect(renderScanUi(data(), { ...initialState(), query: "absent" }, 110, 40).lines.join("\n")).toContain("No matches. Esc clears filters."); expect(renderScanUi(data(), { ...initialState(), query: "repo:invalid" }, 110, 40).lines.join("\n")).toContain("repo: use all / current / unknown"); await expect(loadScanUi(0, options)).rejects.toThrow("whole number");
  });
  it("retains the prior range on failure, retries explicitly, preserves surviving IDs and cannot repaint Home after a late reload", async () => {
    let complete!: (value: ScanUiData) => void; const refresh = vi.fn<(days?: number) => Promise<ScanUiData>>().mockRejectedValueOnce(new Error("cannot read")).mockImplementation(() => new Promise(resolve => { complete = resolve; })); const input = data([scanned(), scanned({ id: "keep-row", label: "Keep this prompt " + "detail ".repeat(100) })]); const term = terminal(60, 20);
    const running = runUiBrowser(input, refresh, plainPalette, term.io, { ...browser, state: { ...initialState(), query: "repo:current", selected: 1 } }); term.input.write("w"); await wait(term, "Refresh failed"); expect(term.frame()).toContain("last 30 days"); expect(refresh).toHaveBeenLastCalledWith(7); term.input.write("wwr"); expect(refresh).toHaveBeenCalledTimes(2); complete(data([scanned({ id: "new-row" }), ...input.sessions], 7)); await wait(term, "Refreshed."); expect(term.frame()).toContain("keep-row"); term.input.write("wq"); const saved = await running; expect(saved).toMatchObject({ days: 7, selectedSessionId: "keep-row", state: { query: "repo:current" }, exitWorkspace: false });
    const home = runAppUi({ repo: "app", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame(); complete(data([], 14)); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(before); term.input.write("q"); await home;
  });
  it.each(["eof", "ctrl-c", "SIGTERM"])("releases generic browser ownership on %s", async event => {
    const before = process.listeners("SIGTERM"); const term = terminal(); const running = runUiBrowser(data(), async () => data(), plainPalette, term.io, browser); if (event === "eof") term.input.end(); else if (event === "ctrl-c") term.input.emit("keypress", "", { name: "c", ctrl: true }); else process.emit("SIGTERM"); expect((await running).exitWorkspace).toBe(true); expect(term.input.listenerCount("keypress")).toBe(0); expect(term.input.listenerCount("end")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(process.listeners("SIGTERM")).toEqual(before);
  });
  it("remembers the real Tool activity range/project/selection/scroll through Home without modifying transcripts or signed records", async () => {
    const label = "First local prompt " + "details ".repeat(100); const source = await transcript("newest-row", options.cwd, label); await transcript("older-row", options.cwd, label, "2026-10-04T12:00:00Z"); const sourceBytes = await readFile(source); await store.appendSession({ intent: "signed goal", startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z" }, options); const ledger = await store.resolveStoreFile(options); const signedBytes = await readFile(ledger); const term = terminal(60, 20); const open = () => term.input.write("m" + "\u001b[B".repeat(UI_MENU.findIndex(item => item.screen === "scan")) + "\r");
    const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" }); await wait(term, "OVERVIEW"); open(); await wait(term, "TOOL ACTIVITY"); term.input.write("w"); await wait(term, "Refreshed."); expect(term.frame()).toContain("last 7 days"); term.input.write("p\u001b[B\u001b[6~"); const frame = term.frame().split("\r\n").slice(0, -1); term.input.write("q"); await wait(term, "OVERVIEW"); open(); await wait(term, "TOOL ACTIVITY"); expect(term.frame().split("\r\n").slice(0, -1)).toEqual(frame); term.input.end(); await running; expect(term.input.listenerCount("keypress")).toBe(0); expect(await readFile(source)).toEqual(sourceBytes); expect(await readFile(ledger)).toEqual(signedBytes);
  });
});
