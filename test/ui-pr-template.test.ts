import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as prCommand from "../src/commands/pr.js";
import { prTemplateUi } from "../src/commands/pr-template-ui.js";
import { runUi, type UiBrowserAction, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { fillTemplate, prParts } from "../src/render/pr.js";
import { ansiPalette, plainPalette, screenControl } from "../src/render/palette.js";
import { canReturnPrHome, navigatePr } from "../src/render/tui/pr.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, zeroCost, type Session } from "../src/store.js";

const session = (extra: Partial<Session> = {}): Session => ({ id: "finished", repo: "path:/example", intent: "finish work", scope: ["src"], baseline: [], reality: ["src/a.ts"], drift: [], cost: { ...zeroCost(), turns: 2, inputTokens: 20, model: "future-model" }, outcome: "open", startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", ...extra });
const data = (sessions = [session()]) => ({ sessions, repo: "example", branch: "main", rates: new Map() });
const chooser = () => ({ ...initialState(), expanded: false }); const preview = () => ({ ...chooser(), expanded: true });
const browser = { returnToHome: true, navigate: navigatePr, canReturnHome: canReturnPrHome };
const action = (controller: ReturnType<typeof prTemplateUi>) => controller.actions![0]!;
const render = (controller: ReturnType<typeof prTemplateUi>, input = data()) => controller.render!(input, preview(), 110, 60).lines.join("\n");
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); }); return { input, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
let root: string; let options: { cwd: string; home: string; adapters: never[] }; const exitCode = process.exitCode;
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-pr-template-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd); });
afterEach(async () => { process.exitCode = exitCode; vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("Local PR template selection", () => {
  it("resolves a relative file in the injected cwd and fills the native placeholders, including unknown cost", async () => {
    const source = "CUSTOM {{intent}}\n{{intent_full}}\n{{scope}}\n{{changed}}\n{{drift}}\n{{cost}}"; await writeFile(path.join(options.cwd, "my template.md"), source);
    const controller = prTemplateUi(options); expect(render(controller)).toContain("Format: default"); await action(controller).run(data(), chooser(), "my template.md");
    expect(action(controller).input!.initial!()).toBe("my template.md");
    for (const record of [session(), session({ intentSource: "captured", scope: [], intent: "First goal.\nFull prompt retained." })]) {
      const filled = fillTemplate(source, prParts(record, new Map())); for (const line of filled.split("\n").filter(Boolean)) expect(render(controller, data([record]))).toContain(line);
    }
    await action(controller).run(data(), chooser(), " "); expect(render(controller)).toContain("Format: default"); expect(action(controller).input!.initial!()).toBe("");
  });
  it("preserves the accepted snapshot on missing/directory/placeholder failures and refuses unmatched sessions before reading", async () => {
    await writeFile(path.join(options.cwd, "good.md"), "ORIGINAL {{intent}}"); await writeFile(path.join(options.cwd, "bad.md"), "{{typo}} {{other}}"); await mkdir(path.join(options.cwd, "folder"));
    const controller = prTemplateUi(options); await action(controller).run(data(), chooser(), "good.md");
    for (const [file, error] of [["missing.md", "No template"], ["folder", "is a directory"], ["bad.md", "{{typo}}, {{other}}"]]) await expect(action(controller).run(data(), chooser(), file)).rejects.toThrow(error);
    expect(render(controller)).toContain("ORIGINAL finish work"); expect(action(controller).input!.initial!()).toBe("good.md");
    const read = vi.spyOn(prCommand, "readTemplate"); await expect(action(controller).run(data(), { ...chooser(), query: "source:unknown" }, "good.md")).rejects.toThrow("Select a matching session"); expect(read).not.toHaveBeenCalled();
  });
  it("keeps accepted contents after the file changes and refills them for the current session and rates", async () => {
    await writeFile(path.join(options.cwd, "good.md"), "ORIGINAL {{intent}}\n{{cost}}"); const controller = prTemplateUi(options); await action(controller).run(data(), chooser(), "good.md");
    await writeFile(path.join(options.cwd, "good.md"), "CHANGED {{intent}}"); const input = data([session({ intent: "second goal", cost: { ...zeroCost(), turns: 1, inputTokens: 1_000_000, model: "known" } })]); input.rates.set("known", { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 });
    expect(render(controller, input)).toContain("ORIGINAL second goal"); expect(render(controller, input)).toContain("$1.00 · 1 turn"); expect(render(controller, input)).not.toContain("CHANGED");
  });
  it("treats q/r as path characters, cancels without changing the accepted template, and applies a blank default", async () => {
    await writeFile(path.join(options.cwd, "qr.md"), "CUSTOM {{intent}}"); const controller = prTemplateUi(options); const term = terminal(); const refresh = vi.fn(async () => data());
    const running = runUi(data(), refresh, plainPalette, term.io, { ...browser, ...controller, state: chooser() }); term.input.write("tqr"); expect(term.frame()).toContain("> qr▌"); expect(refresh).not.toHaveBeenCalled(); term.input.write(".md\r"); await wait(term, "Template loaded:");
    term.input.write("t\u0015missing"); term.input.emit("keypress", "", { name: "escape" }); expect(action(controller).input!.initial!()).toBe("qr.md"); term.input.write("\r"); expect(term.frame()).toContain("CUSTOM finish work");
    term.input.write("t\u0015\r"); await wait(term, "Default format selected"); expect(action(controller).input!.initial!()).toBe(""); term.input.write("q"); await running;
  });
  it("edits graphemes, accepts bracketed path text and ignores pasted control/submission sequences", async () => {
    const term = terminal(); const run = vi.fn<UiBrowserAction["run"]>(async () => "applied"); const inputAction: UiBrowserAction = { key: "t", label: "Template", input: { label: "Path" }, run };
    const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, state: chooser(), actions: [inputAction] }); term.input.write("t"); term.input.emit("keypress", "", { sequence: "e\u0301" }); term.input.emit("keypress", "", { name: "backspace" });
    term.input.emit("keypress", "", { sequence: "\u001b[200~" }); term.input.write("qr.md\r"); term.input.emit("keypress", "", { sequence: "\u001b[2J" }); term.input.emit("keypress", "", { sequence: "\u001b[201~" }); expect(run).not.toHaveBeenCalled();
    term.input.write("\r"); await wait(term, "applied"); expect(run.mock.calls[0]![2]).toBe("qr.md"); term.input.write("q"); await running;
  });
  it("aborts a pending read on Back so late completion cannot replace the persisted template", async () => {
    await writeFile(path.join(options.cwd, "good.md"), "ORIGINAL {{intent}}"); const controller = prTemplateUi(options); await action(controller).run(data(), chooser(), "good.md");
    let finish!: (source: string) => void; vi.spyOn(prCommand, "readTemplate").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const term = terminal();
    const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, ...controller, state: chooser() }); term.input.write("t\u0015new.md\rq"); await running; finish("LATE {{intent}}"); await new Promise(resolve => setImmediate(resolve));
    expect(action(controller).input!.initial!()).toBe("good.md"); expect(render(controller)).toContain("ORIGINAL finish work"); const aborted = new AbortController(); aborted.abort(); await expect(action(controller).run(data(), chooser(), "", aborted.signal)).rejects.toThrow(); expect(action(controller).input!.initial!()).toBe("good.md");
  });
  it("keeps the prompt bounded through resize with plain/colour parity and safely displays custom content", async () => {
    await writeFile(path.join(options.cwd, "safe.md"), "CUSTOM\u001b[2J{{intent}}\n{{changed}}\n{{cost}}"); const controller = prTemplateUi(options); await action(controller).run(data(), chooser(), "safe.md");
    const frames: string[][] = []; for (const palette of [plainPalette, ansiPalette]) {
      const term = terminal(60, 20); const running = runUi(data(), async () => data(), palette, term.io, { ...browser, ...controller, state: preview() }); term.input.write("t"); Object.assign(term.io.output, { columns: 59 }); term.io.output.emit("resize"); expect(stripVTControlCharacters(term.frame())).toContain("Resize to at least");
      Object.assign(term.io.output, { columns: 60 }); term.io.output.emit("resize"); const lines = stripVTControlCharacters(term.frame()).split("\r\n"); expect(lines.length).toBeLessThanOrEqual(19); expect(lines.every(line => cellWidth(line) <= 59)).toBe(true); frames.push(lines);
      term.input.emit("keypress", "", { name: "escape" }); expect(stripVTControlCharacters(term.frame())).toContain("CUSTOMfinish work"); if (palette === plainPalette) expect(term.frame()).not.toContain("\u001b"); term.input.write("q"); await running;
    } expect(frames[0]).toEqual(frames[1]);
  });
  it("lets Ctrl-C interrupt even inside paste and EOF release an active input without submission", async () => {
    for (const interrupted of [false, true]) {
      const term = terminal(); const run = vi.fn(async () => "applied"); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, state: chooser(), actions: [{ key: "t", label: "Template", input: { label: "Path" }, run }] }); term.input.write("t");
      if (interrupted) { term.input.emit("keypress", "", { sequence: "\u001b[200~" }); term.input.emit("keypress", "", { name: "c", ctrl: true }); } else term.input.end();
      expect((await running).exitWorkspace).toBe(true); expect(run).not.toHaveBeenCalled(); expect(term.input.listenerCount("keypress")).toBe(0); expect(term.input.listenerCount("end")).toBe(0);
    }
  });
  it("remembers the accepted template across Home and refresh without rewriting the signed ledger", async () => {
    await writeFile(path.join(options.cwd, "good.md"), "ORIGINAL {{intent}}"); await appendSession({ intent: "recorded goal", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), startCommit: "base" }, options);
    const file = await resolveStoreFile(options); const before = await readFile(file); const term = terminal(); const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" }); const open = () => term.input.write("m\u001b[B\u001b[B\u001b[B\u001b[B\r");
    await wait(term, "OVERVIEW"); open(); await wait(term, "Recorded result"); term.input.write("tgood.md\r"); await wait(term, "Template loaded:"); term.input.write("\rq"); await wait(term, "OVERVIEW"); await writeFile(path.join(options.cwd, "good.md"), "CHANGED {{intent}}");
    open(); await wait(term, "MARKDOWN PREVIEW"); expect(term.frame()).toContain("ORIGINAL recorded goal"); term.input.write("r"); await wait(term, "Refreshed."); expect(term.frame()).toContain("ORIGINAL recorded goal"); term.input.write("q"); await wait(term, "OVERVIEW"); term.input.write("q"); await running; expect(await readFile(file)).toEqual(before);
  });
});
