import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { runUi, type UiTerminal } from "../src/commands/ui.js";
import { weekExportActions } from "../src/commands/week-export-ui.js";
import { loadWeekUi } from "../src/commands/week-ui.js";
import type { WeekOptions } from "../src/commands/week.js";
import { buildProgram } from "../src/program.js";
import { renderWeek } from "../src/render/html.js";
import { renderMarkdownWeek } from "../src/render/markdown.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import { navigateWeek, renderWeekUi, WEEK_WINDOWS } from "../src/render/tui/week.js";
import { appendSession, resolveStoreFile, zeroCost, type Session } from "../src/store.js";

const cost = { ...zeroCost(), turns: 2, model: "known", inputTokens: 20, agents: ["vibe"] };
const session = (extra: Partial<Session> = {}): Session => ({ id: "ship", repo: "path:/example", intent: "ship work", scope: ["src"], baseline: [], reality: ["src/a.ts"], drift: [], cost, outcome: "merged", startCommit: "base", startedAt: "2026-10-05T12:00:00Z", endedAt: "2026-10-05T13:00:00Z", ...extra });
const data = (days = 7) => ({ days, repo: "example", checked: "2026-10-01", rates: new Map([["known", { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 }]]),
  agents: [{ name: "vibe", reportsCalls: false, recognises: () => true }], sessions: [session(), session({ id: "other", intent: "other work", intentSource: "captured" })] });
const browser = { returnToHome: true, render: renderWeekUi, navigate: navigateWeek, windows: WEEK_WINDOWS };
const action = (key: string, options: WeekOptions) => weekExportActions(options).find(item => item.key === key)!;
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns: 110, rows: 40 });
  let rendered = ""; output.on("data", chunk => { rendered += String(chunk); });
  return { input, io: { input, output } as unknown as UiTerminal, frame: () => rendered.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
let root: string; let options: WeekOptions; const exitCode = process.exitCode;
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T16:00:00Z")); root = await mkdtemp(path.join(tmpdir(), "session-week-export-")); options = { cwd: root, home: path.join(root, "store"), tmp: root }; });
afterEach(async () => { process.exitCode = exitCode; vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("Week exports use the loaded selection", () => {
  it("copies the exact native Markdown with loaded rates and explicit range/filter provenance", async () => {
    const input = data(14); const state = { ...initialState(), outcome: 2, source: 1, outside: 2, query: "ship" }; const copy = vi.fn(async (_text: string) => {});
    await action("c", { ...options, copy }).run(input, state);
    const selection = "outcome:merged · source:declared · outside:no · search: ship";
    expect(copy).toHaveBeenCalledWith(renderMarkdownWeek([input.sessions[0]!], 14, { ...input, selection }));
    expect(copy.mock.calls[0]![0]).toContain(`Selection: ${selection}`); expect(copy.mock.calls[0]![0]).not.toContain("other work");
  });
  it("writes the exact native HTML with usage and adapter evidence, then launches its private file", async () => {
    const input = data(30); const launch = vi.fn(async (_file: string) => {}); await action("h", { ...options, launch }).run(input, { ...initialState(), source: 1, usage: true });
    const file = launch.mock.calls[0]![0]; expect(await readFile(file, "utf8")).toBe(renderWeek([input.sessions[0]!], 30, {}, { ...input, tokens: true, selection: "source:declared" }));
    expect((await stat(file)).mode & 0o777).toBe(0o600); expect(path.dirname(file)).toBe(root);
  });
  it("escapes selection markup in both formats and preserves an explicitly filtered empty report", async () => {
    const query = '<script>alert("x")</script> [link](x)\n**bold**'; const copy = vi.fn(async (_text: string) => {}); const launch = vi.fn(async (_file: string) => {});
    await action("c", { ...options, copy }).run(data(), { ...initialState(), query }); const markdown = copy.mock.calls[0]![0];
    expect(markdown).toContain("Selection: search: \\<script\\>"); expect(markdown).toContain("\\[link\\]\\(x\\) \\*\\*bold\\*\\*"); expect(markdown).toContain("No sessions with any changes");
    await action("h", { ...options, launch }).run(data(), { ...initialState(), query }); const html = await readFile(launch.mock.calls[0]![0], "utf8");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)"); expect(html).not.toContain("<script>"); expect(html).toContain("No sessions in the last 7 days, search:");
  });
  it("refuses invalid filters or a missing Week range before any clipboard/file/browser effects", async () => {
    const copy = vi.fn(async (_text: string) => {}); const launch = vi.fn(async (_file: string) => {});
    for (const state of [{ ...initialState(), query: "outside:perhaps" }, { ...initialState(), source: 99 }, { ...initialState(), outcome: -1 }, { ...initialState(), outside: 99 }]) for (const key of ["c", "h"]) await expect(action(key, { ...options, copy, launch }).run(data(), state)).rejects.toThrow("Fix the search");
    await expect(action("c", { ...options, copy }).run({ ...data(), days: undefined }, initialState())).rejects.toThrow("Choose a Week range");
    expect(copy).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
  });
  it("shows clipboard errors with retry and preserves a saved HTML path when launch fails", async () => {
    const copy = vi.fn().mockRejectedValueOnce(new Error("clipboard unavailable")).mockResolvedValue(undefined); const term = terminal();
    const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, actions: weekExportActions({ ...options, copy }) }); term.input.write("c"); await wait(term, "clipboard unavailable");
    term.input.write("c"); await wait(term, "Copied Markdown"); expect(copy).toHaveBeenCalledTimes(2); term.input.write("q"); await running;
    const launch = vi.fn(async (_file: string) => { throw new Error("browser unavailable"); }); await expect(action("h", { ...options, launch }).run(data(), initialState())).rejects.toThrow("HTML saved. Open");
    const file = launch.mock.calls[0]![0]; expect(await readFile(file, "utf8")).toBe(renderWeek(data().sessions, 7, {}, { ...data(), tokens: false, selection: "all sessions" }));
  });
  it("keeps export letters as search text and blocks Help, Ctrl and bracketed paste actions", async () => {
    const run = vi.fn(async () => "exported"); const term = terminal(); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, actions: [{ key: "c", label: "Copy", run }, { key: "h", label: "HTML", run }] });
    term.input.write("/ch\r"); expect(term.frame()).toContain("│ > ch"); term.input.emit("keypress", "", { name: "escape" }); term.input.write("?ch"); term.input.emit("keypress", "", { name: "escape" });
    term.input.emit("keypress", "", { name: "h", ctrl: true }); term.input.emit("keypress", "", { sequence: "\u001b[200~" }); term.input.write("ch"); term.input.emit("keypress", "", { sequence: "\u001b[201~" });
    expect(run).not.toHaveBeenCalled(); term.input.emit("keypress", "", { name: "c", ctrl: true }); expect((await running).exitWorkspace).toBe(true); expect(run).not.toHaveBeenCalled();
  });
  it("serializes range reloads and exports while taking the filter snapshot at invocation", async () => {
    let finishCopy!: () => void; let finishRange!: (value: ReturnType<typeof data>) => void;
    const copy = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finishCopy = resolve; })).mockResolvedValue(undefined);
    const refresh = vi.fn(() => new Promise<ReturnType<typeof data>>(resolve => { finishRange = resolve; })); const launch = vi.fn(async (_file: string) => {}); const term = terminal();
    const running = runUi(data(), refresh, plainPalette, term.io, { ...browser, actions: weekExportActions({ ...options, copy, launch }) }); term.input.write("cwch");
    expect(copy).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled(); term.input.write("s"); finishCopy(); await wait(term, "Copied Markdown");
    expect(copy.mock.calls[0]![0]).toBe(renderMarkdownWeek(data().sessions, 7, { ...data(), selection: "all sessions" }));
    term.input.write("wch"); expect(refresh).toHaveBeenCalledTimes(1); expect(copy).toHaveBeenCalledTimes(1); finishRange(data(14)); await wait(term, "last 14 days"); term.input.write("c"); await wait(term, "Copied Markdown");
    expect(copy.mock.calls[1]![0]).toBe(renderMarkdownWeek([data().sessions[0]!], 14, { ...data(), selection: "source:declared" })); term.input.write("q"); await running;
  });
  it("does not repaint Home after an export completes or fails after Back", async () => {
    for (const reject of [false, true]) {
      let complete!: (value: string | PromiseLike<string>) => void; let fail!: (error: Error) => void; const term = terminal();
      const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, actions: [{ key: "c", label: "Copy", run: () => new Promise<string>((resolve, rejected) => { complete = resolve; fail = rejected; }) }] });
      term.input.write("cq"); await running; const home = runAppUi({ repo: "example", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame();
      if (reject) fail(new Error("late failure")); else complete("late success"); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(before); term.input.write("q"); await home;
    }
  });
  it("does not start export effects after its status paint fails and closes the browser", async () => {
    const term = terminal(); const run = vi.fn(async () => "exported"); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, actions: [{ key: "h", label: "HTML", run }] });
    vi.spyOn(term.io.output, "write").mockImplementationOnce(() => { throw new Error("paint failure"); });
    const rejected = expect(running).rejects.toThrow("paint failure"); term.input.write("h"); await rejected;
    expect(run).not.toHaveBeenCalled(); expect(term.input.listenerCount("keypress")).toBe(0);
  });
  it("bounds export controls and long recovery paths at 60×20 with matching colour geometry", () => {
    const query = "source:declared source:primed source:captured outside:yes outside:no outcome:open outcome:merged outcome:abandoned outcome:empty";
    const notice = `HTML saved. Open /private/tmp/${"long-folder/".repeat(20)}session-week.html yourself.`;
    for (const inputQuery of ["", "source:declared outside:no outcome:merged", query]) for (const help of [false, true]) {
      const state = { ...initialState(), usage: true, query: inputQuery, help }; const plain = renderWeekUi(data(), state, 60, 20, plainPalette, notice);
      const colour = renderWeekUi(data(), state, 60, 20, ansiPalette, notice, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } }));
      expect(plain.lines.length).toBeLessThanOrEqual(19); expect(plain.lines.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.lines.map(stripVTControlCharacters)).toEqual(plain.lines);
      for (const key of ["c", "h", "w", "u", "o", "s", "d"]) expect(plain.lines.join("\n")).toContain(`[${key}]`);
      const bodyStart = plain.lines.findIndex(line => line.includes("HTML saved. Open")); expect(bodyStart).toBeGreaterThanOrEqual(0);
      const pages = Array.from({ length: plain.maxScroll + 1 }, (_, scroll) => renderWeekUi(data(), { ...state, scroll }, 60, 20, plainPalette, notice).lines[bodyStart]).join("");
      expect(pages.replace(/\s/gu, "")).toContain(notice.replace(/\s/gu, ""));
    }
  });
  it("exports from the real Week menu with its current range/filters and leaves signed bytes intact", async () => {
    const cwd = path.join(root, "repo"); await mkdir(cwd); const copy = vi.fn(async (_text: string) => {}); const launch = vi.fn(async (_file: string) => {}); const injected = { ...options, cwd, copy, launch, adapters: [] };
    await appendSession({ intent: "recorded work", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), startCommit: "base", cost }, injected); const file = await resolveStoreFile(injected); const before = await readFile(file); const term = terminal();
    const running = buildProgram({ ...injected, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" }); await wait(term, "OVERVIEW"); term.input.write("m\u001b[B\u001b[B\u001b[B\r"); await wait(term, "last 7 days");
    term.input.write("w"); await wait(term, "last 14 days"); term.input.write("suc"); await wait(term, "Copied Markdown"); term.input.write("h"); await wait(term, "Opened HTML"); const loaded = await loadWeekUi(14, injected);
    expect(copy.mock.calls[0]![0]).toBe(renderMarkdownWeek(loaded.sessions, 14, { ...loaded, selection: "source:declared" })); expect(await readFile(launch.mock.calls[0]![0], "utf8")).toBe(renderWeek(loaded.sessions, 14, {}, { ...loaded, tokens: true, selection: "source:declared" }));
    term.input.write("q"); await wait(term, "OVERVIEW"); term.input.write("q"); await running; expect(await readFile(file)).toEqual(before);
  });
});
