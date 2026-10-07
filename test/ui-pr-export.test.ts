import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { prExportActions } from "../src/commands/pr-export-ui.js";
import { loadPrUi } from "../src/commands/pr-ui.js";
import { prTemplateUi } from "../src/commands/pr-template-ui.js";
import { runUi, type UiBrowserAction, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { fillTemplate, prParts, renderPr } from "../src/render/pr.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { canReturnPrHome, navigatePr, prUiDocument, renderPrUi } from "../src/render/tui/pr.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, zeroCost, type Session } from "../src/store.js";

const session = (extra: Partial<Session> = {}): Session => ({ id: "finished", repo: "path:/example", intent: "finish work", scope: ["src"], baseline: [], reality: ["src/a.ts"], drift: [], cost: { ...zeroCost(), turns: 2, inputTokens: 20, model: "future-model" }, outcome: "merged", startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", ...extra });
const data = (sessions = [session()]) => ({ sessions, repo: "example", branch: "main", rates: new Map() });
const preview = () => ({ ...initialState(), expanded: true });
const browser = { returnToHome: true, render: renderPrUi, navigate: navigatePr, canReturnHome: canReturnPrHome };
const action = (actions: readonly UiBrowserAction[], key: string) => actions.find(item => item.key === key)!;
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); }); return { input, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
let root: string; let options: { cwd: string; home: string; adapters: never[] }; const exitCode = process.exitCode;
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-pr-export-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd); });
afterEach(async () => { process.exitCode = exitCode; vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("PR copy and create-only save", () => {
  it("copies the complete native document for each source, including captured prompts, all paths and unknown prices", async () => {
    const copy = vi.fn(async (_text: string) => {}); const actions = prExportActions(() => undefined, { ...options, copy });
    for (const source of ["declared", "primed", "captured"] as const) {
      const record = session({ intentSource: source, intent: "First goal.\n" + "Full recorded prompt with ``` fences and </details>. ".repeat(10), reality: Array.from({ length: 40 }, (_, index) => `src/file-${index}.ts`), scope: source === "captured" ? [] : ["src"] });
      const input = data([record]); await action(actions, "c").run(input, preview()); const body = copy.mock.calls.at(-1)![0]; expect(body).toBe(renderPr(record, input.rates)); expect(prUiDocument(record, input.rates)).toBe(body);
      expect(body).toContain("future-model"); expect(body).not.toContain("$0.00"); for (const file of record.reality) expect(body).toContain(file); if (source === "captured") expect(body).toContain(record.intent!.trim());
    }
  });
  it("exports the accepted template snapshot filled for the selected filtered session without rereading its file", async () => {
    const source = "CUSTOM {{intent}}\n{{intent_full}}\n{{scope}}\n{{changed}}\n{{drift}}\n{{cost}}"; await writeFile(path.join(options.cwd, "template.md"), source); const copy = vi.fn(async (_text: string) => {}); const controller = prTemplateUi({ ...options, copy });
    await action(controller.actions!, "t").run(data(), preview(), "template.md"); await writeFile(path.join(options.cwd, "template.md"), "CHANGED {{intent}}"); const record = session({ id: "captured", intentSource: "captured", intent: "New goal.\nFull prompt.", scope: [] }); const input = data([session(), record]); const state = { ...preview(), query: "source:captured" };
    await action(controller.actions!, "c").run(input, state); await action(controller.actions!, "f").run(input, state, "template result.md"); const body = fillTemplate(source, prParts(record, input.rates), "template.md"); expect(copy).toHaveBeenCalledWith(body); expect(await readFile(path.join(options.cwd, "template result.md"), "utf8")).toBe(body + "\n");
  });
  it("creates a private Markdown file relative to the injected cwd, preserving exact bytes and adding one newline", async () => {
    const save = action(prExportActions(() => undefined, options), "f"); expect(save.input!.initial!()).toBe("session-pr.md"); await save.run(data(), preview(), "my PR.md"); const file = path.join(options.cwd, "my PR.md");
    expect(await readFile(file, "utf8")).toBe(renderPr(session(), new Map()) + "\n"); expect((await stat(file)).mode & 0o777).toBe(0o600); expect(await readdir(root)).toEqual(["repo"]);
  });
  it("refuses invalid or absent selections, blank paths, aborted calls and existing destinations before effects", async () => {
    const copy = vi.fn(async (_text: string) => {}); const actions = prExportActions(() => undefined, { ...options, copy });
    for (const state of [{ ...preview(), query: "source:unknown" }, { ...preview(), source: 99 }, { ...preview(), selected: -1 }, { ...preview(), query: "no-match" }, { ...preview(), query: "source:captured", source: 1 }]) for (const key of ["c", "f"]) await expect(action(actions, key).run(data(), state, "forbidden.md")).rejects.toThrow("Select a matching session");
    await expect(action(actions, "f").run(data(), preview(), " ")).rejects.toThrow("Enter a Markdown file path"); const aborted = new AbortController(); aborted.abort(); for (const key of ["c", "f"]) await expect(action(actions, key).run(data(), preview(), "aborted.md", aborted.signal)).rejects.toThrow(); expect(copy).not.toHaveBeenCalled(); expect(await readdir(options.cwd)).toEqual([]);
    await writeFile(path.join(options.cwd, "kept.md"), "original bytes"); await expect(action(actions, "f").run(data(), preview(), "kept.md")).rejects.toThrow("Existing files are kept"); expect(await readFile(path.join(options.cwd, "kept.md"), "utf8")).toBe("original bytes"); await expect(action(actions, "f").run(data(), preview(), "missing/result.md")).rejects.toThrow("choose an existing directory");
  });
  it("keeps the preview after clipboard or save errors and permits a successful retry", async () => {
    const copy = vi.fn().mockRejectedValueOnce(new Error("clipboard unavailable")).mockResolvedValue(undefined); const term = terminal(); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, state: preview(), actions: prExportActions(() => undefined, { ...options, copy }) });
    term.input.write("c"); await wait(term, "clipboard unavailable"); expect(term.frame()).toContain("MARKDOWN PREVIEW"); term.input.write("c"); await wait(term, "Copied PR description"); await writeFile(path.join(options.cwd, "session-pr.md"), "kept"); term.input.write("f\r"); await wait(term, "Existing files are kept"); expect(term.frame()).toContain("MARKDOWN PREVIEW");
    term.input.write("f\u0015retry.md\r"); await wait(term, "Saved PR description"); expect(await readFile(path.join(options.cwd, "session-pr.md"), "utf8")).toBe("kept"); expect(await readFile(path.join(options.cwd, "retry.md"), "utf8")).toBe(renderPr(session(), new Map()) + "\n"); term.input.write("q"); await running;
  });
  it("guards copy/save in search, Help, Ctrl and paste, and lets destination input cancel without closing its preview", async () => {
    const copy = vi.fn(async (_text: string) => {}); const term = terminal(); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, state: preview(), actions: prExportActions(() => undefined, { ...options, copy }) });
    term.input.write("/cf\r"); expect(term.frame()).toContain("> cf"); term.input.emit("keypress", "", { name: "escape" }); term.input.write("?cf"); term.input.emit("keypress", "", { name: "escape" }); term.input.emit("keypress", "", { name: "f", ctrl: true }); term.input.emit("keypress", "", { sequence: "\u001b[200~" }); term.input.write("cf"); term.input.emit("keypress", "", { sequence: "\u001b[201~" }); expect(copy).not.toHaveBeenCalled(); expect(await readdir(options.cwd)).toEqual([]);
    term.input.write("\rf\u0015qr.md"); expect(term.frame()).toContain("> qr.md▌"); term.input.emit("keypress", "", { name: "escape" }); expect(term.frame()).toContain("MARKDOWN PREVIEW"); expect(await readdir(options.cwd)).toEqual([]);
    term.input.write("f\u0015"); term.input.emit("keypress", "", { sequence: "\u001b[200~" }); term.input.write("qr.md\r"); term.input.emit("keypress", "", { sequence: "\u001b[2J" }); term.input.emit("keypress", "", { sequence: "\u001b[201~" }); expect(await readdir(options.cwd)).toEqual([]); term.input.write("\r"); await wait(term, "Saved PR description"); expect(await readFile(path.join(options.cwd, "qr.md"), "utf8")).toBe(renderPr(session(), new Map()) + "\n"); term.input.write("q"); await running;
  });
  it("serializes exports and refresh while freezing the chosen session at invocation", async () => {
    let finishCopy!: () => void; let finishRefresh!: (value: ReturnType<typeof data>) => void; const copy = vi.fn<(text: string) => Promise<void>>().mockImplementationOnce(() => new Promise(resolve => { finishCopy = resolve; })).mockResolvedValue(undefined);
    const second = session({ id: "second", intent: "second goal" }); const refresh = vi.fn(() => new Promise<ReturnType<typeof data>>(resolve => { finishRefresh = resolve; })); const term = terminal(); const running = runUi(data([session(), second]), refresh, plainPalette, term.io, { ...browser, state: preview(), actions: prExportActions(() => undefined, { ...options, copy }) });
    term.input.write("crf\u001b[B"); expect(copy).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled(); expect(term.frame()).not.toContain("Markdown file path"); finishCopy(); await wait(term, "Copied PR description"); expect(copy.mock.calls[0]![0]).toBe(renderPr(session(), new Map()));
    term.input.write("rcf"); expect(refresh).toHaveBeenCalledTimes(1); expect(copy).toHaveBeenCalledTimes(1); const updated = session({ ...second, intent: "refreshed second goal" }); finishRefresh(data([updated, session()])); await wait(term, "Refreshed."); term.input.write("c"); await wait(term, "Copied PR description"); expect(copy.mock.calls[1]![0]).toBe(renderPr(updated, new Map())); expect(await readdir(options.cwd)).toEqual([]); term.input.write("q"); await running;
  });
  it("cannot repaint Home after an invoked clipboard operation completes or fails after Back", async () => {
    for (const rejected of [false, true]) {
      let finish!: () => void; let fail!: (error: Error) => void; const copy = vi.fn(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; })); const term = terminal(); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, actions: prExportActions(() => undefined, { ...options, copy }) });
      term.input.write("cq"); await running; const home = runAppUi({ repo: "example", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame(); if (rejected) fail(new Error("late clipboard failure")); else finish(); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(before); term.input.write("q"); await home;
    }
  });
  it("starts no clipboard effect when the action status paint fails and releases owned listeners", async () => {
    const copy = vi.fn(async (_text: string) => {}); const term = terminal(); const running = runUi(data(), async () => data(), plainPalette, term.io, { ...browser, actions: prExportActions(() => undefined, { ...options, copy }) }); vi.spyOn(term.io.output, "write").mockImplementationOnce(() => { throw new Error("paint failure"); }); const failure = expect(running).rejects.toThrow("paint failure"); term.input.write("c"); await failure; expect(copy).not.toHaveBeenCalled(); expect(term.input.listenerCount("keypress")).toBe(0);
  });
  it("bounds all export controls and recovery text at 60×20 with plain/colour geometry parity", () => {
    const query = "source:declared source:primed source:captured outside:yes outside:no outcome:open outcome:merged outcome:abandoned outcome:empty"; const notice = `cannot save /private/tmp/${"long-folder/".repeat(15)}result.md; choose another path and retry.`;
    for (const state of [preview(), { ...preview(), help: true }, { ...preview(), expanded: false, query }]) {
      const plain = renderPrUi(data(), state, 60, 20, plainPalette, notice); const colour = renderPrUi(data(), state, 60, 20, ansiPalette, notice, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })); expect(plain.lines.length).toBeLessThanOrEqual(19); expect(plain.lines.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.lines.map(stripVTControlCharacters)).toEqual(plain.lines); for (const key of ["c", "f", "t"]) expect(plain.lines.join("\n")).toContain(`[${key}]`);
      const start = plain.lines.findIndex(line => line.includes("cannot save")); expect(start).toBeGreaterThanOrEqual(0); const pages = Array.from({ length: plain.maxScroll + 1 }, (_, scroll) => renderPrUi(data(), { ...state, scroll }, 60, 20, plainPalette, notice).lines[start]).join(""); expect(pages.replace(/\s/gu, "")).toContain(notice.replace(/\s/gu, ""));
    }
  });
  it("copies and saves through the real PR workspace with its accepted snapshot and unchanged signed bytes", async () => {
    const copy = vi.fn(async (_text: string) => {}); const injected = { ...options, copy }; const source = "CUSTOM {{intent}}\n{{changed}}\n{{cost}}"; await writeFile(path.join(options.cwd, "template.md"), source); await appendSession({ intent: "recorded goal", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), startCommit: "base" }, options); const ledger = await resolveStoreFile(options); const before = await readFile(ledger); const term = terminal();
    const running = buildProgram({ ...injected, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" }); await wait(term, "OVERVIEW"); term.input.write("m\u001b[B\u001b[B\u001b[B\u001b[B\r"); await wait(term, "Recorded result"); term.input.write("t\u0015template.md\r"); await wait(term, "Template loaded:"); await writeFile(path.join(options.cwd, "template.md"), "CHANGED {{intent}}"); term.input.write("\rsc"); await wait(term, "Copied PR description"); term.input.write("f\r"); await wait(term, "Saved PR description"); const loaded = await loadPrUi(options); const body = fillTemplate(source, prParts(loaded.sessions[0]!, loaded.rates), "template.md"); expect(copy).toHaveBeenCalledWith(body); expect(await readFile(path.join(options.cwd, "session-pr.md"), "utf8")).toBe(body + "\n"); term.input.write("q"); await wait(term, "OVERVIEW"); term.input.write("q"); await running; expect(await readFile(ledger)).toEqual(before);
  });
});
