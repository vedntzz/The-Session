import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debtHere, primeFor } from "../src/commands/prime.js";
import * as prime from "../src/commands/prime.js";
import { loadPrimeUi, runPrimeUi } from "../src/commands/prime-ui.js";
import { runAppUi } from "../src/commands/app-ui.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { plainPalette, ansiPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { formatPrimeDetails } from "../src/render/prime.js";
import { navigatePrime, renderPrimeUi, type PrimeUiData } from "../src/render/tui/prime.js";
import { initialState } from "../src/render/tui/state.js";
import { cellWidth, safeText } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, zeroCost } from "../src/store.js";

const exec = promisify(execFile);
const request = { intent: "Fix orders rate limiting", seeds: ["src/name with spaces, commas.ts"] };
const compact = (text: string) => text.replace(/\s/gu, "");
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
const savedDraft = () => ({ state: initialState(), request: { ...request, seeds: [...request.seeds] }, exitWorkspace: false });
function body(lines: string[]): string[] { return lines.slice(lines.findIndex(line => line.includes("g Goal")) + 1, lines.findLastIndex(line => /^─+$/u.test(line.trim()))); }
let root: string; let options: { cwd: string; home: string; adapters: never[] };
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-ui-prime-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd);
  await exec("git", ["init", "-q", "-b", "main", options.cwd]); await mkdir(path.join(options.cwd, "src")); await mkdir(path.join(options.cwd, "src-other"));
  for (const file of ["src/accepted.ts", request.seeds[0]!, ...Array.from({ length: 8 }, (_, n) => `src/missed-${n}.ts`), "src-other/sibling.ts"]) await writeFile(path.join(options.cwd, file), "unchanged\n");
  await exec("git", ["-C", options.cwd, "add", "-A"]); await exec("git", ["-C", options.cwd, "-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "-q", "-m", "initial"]);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function history() {
  const base = (await exec("git", ["-C", options.cwd, "rev-parse", "HEAD"])).stdout.trim();
  for (let n = 1; n <= 3; n++) await appendSession({ id: `support-session-${n}`, intent: "Add orders rate limiting", scope: ["src/accepted.ts"], reality: ["src/accepted.ts", ...Array.from({ length: 8 }, (_, i) => `src/missed-${i}.ts`)], drift: Array.from({ length: 8 }, (_, i) => `src/missed-${i}.ts`), startedAt: `2026-09-0${n}T12:00:00Z`, endedAt: `2026-09-0${n}T13:00:00Z`, startCommit: base, cost: zeroCost() }, options);
  return resolveStoreFile(options);
}

describe("Read-only Plan and Prime preview", () => {
  it("loads a draft without a preview and computes exact native proposal/debt only when requested, without creating a store", async () => {
    const draft = await loadPrimeUi(request, options); expect(draft.request).toEqual(request); expect(draft.preview).toBeUndefined();
    const preview = await loadPrimeUi(request, options, true); expect(preview.preview).toEqual({ proposal: await primeFor(request, options), debt: await debtHere(options) }); expect(preview.preview!.proposal.candidates).toEqual([{ path: request.seeds[0], reason: "named", sessions: [] }]);
    await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" }); expect((await exec("git", ["-C", options.cwd, "status", "--porcelain"])).stdout).toBe("");
  });
  it("retains native history, named evidence, support IDs, coverage, omissions and separate debt without ledger writes", async () => {
    const ledger = await history(); const before = await readFile(ledger); const loaded = await loadPrimeUi(request, options, true); const preview = loaded.preview!;
    expect(preview).toEqual({ proposal: await primeFor(request, options), debt: await debtHere(options) }); expect(preview.proposal.comparable).toBe(3); expect(preview.proposal.omitted).toBeGreaterThan(0); expect(preview.proposal).not.toHaveProperty("debt");
    const text = compact(renderPrimeUi(loaded, initialState(), 150, 150).lines.join("")); for (const line of formatPrimeDetails(preview.proposal, preview.debt)) expect(text).toContain(compact(safeText(line)));
    for (const value of ["named with --seed", "support-session-1", "exact paths only", "further candidates", "session prime --debt"]) expect(text).toContain(compact(value)); expect(text).not.toContain("$"); expect(await readFile(ledger)).toEqual(before);
  });
  it("shows native missing/broad seed abstentions and refuses escaping seeds before any store effect", async () => {
    for (const seeds of [["missing.ts"], ["src"], ["src/name with spaces, commas.ts/"]]) { const loaded = await loadPrimeUi({ ...request, seeds }, options, true); expect(loaded.preview!.proposal).toEqual(await primeFor({ ...request, seeds }, options)); }
    const broad = await loadPrimeUi({ ...request, seeds: ["src"] }, options, true); expect(broad.preview!.proposal.scope).toEqual([]); expect(broad.preview!.proposal.reason).toContain("cover 10 files");
    for (const seed of [".", "", "../escape.ts", "/tmp/file.ts"]) await expect(loadPrimeUi({ ...request, seeds: [seed] }, options, true)).rejects.toThrow("inside the repo"); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("clones drafts and accepts literal editing/paste/cancellation while Enter never previews or starts a session", async () => {
    const original = { ...request, seeds: [...request.seeds] }; const loaded = await loadPrimeUi(original, options); original.seeds.push("later.ts"); expect(loaded.request.seeds).toEqual(request.seeds); const previews = vi.spyOn(prime, "primeFor"); const term = terminal(); const running = runPrimeUi(options, plainPalette, term.io, savedDraft()); await wait(term, "PLAN WITH PRIME");
    term.input.write("\rg\u0015"); expect(term.frame()).toContain("No session started"); term.input.write("q r g s p ? e\u0301 修复\r"); await wait(term, "Goal updated"); term.input.write("g\u0015discard this"); term.input.emit("keypress", "", { name: "escape" }); await wait(term, "Input cancelled"); term.input.write("s\u0015\u001b[200~[]\u001b[201~\r"); await wait(term, "Named paths updated"); term.input.write("\rq"); const saved = await running;
    expect(saved.request).toEqual({ intent: "q r g s p ? e\u0301 修复", seeds: [] }); expect(previews).not.toHaveBeenCalled(); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves valid seed paths and an existing preview on JSON, shape and native boundary errors", async () => {
    const term = terminal(); const running = runPrimeUi(options, plainPalette, term.io, savedDraft()); await wait(term, "PLAN WITH PRIME"); term.input.write("p"); await wait(term, "Preview updated");
    for (const value of ["not JSON", '"src/accepted.ts"', '[4]', '["../escape.ts"]', '["/tmp/file.ts"]', '["."]', '[""]']) { term.input.write("s\u0015" + value + "\r"); await wait(term, "Named paths failed"); expect(term.frame()).toContain("exact paths only"); }
    term.input.write("q"); expect((await running).request).toEqual(request); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("invalidates old evidence after valid goal/seed changes and clears named paths with []", async () => {
    const term = terminal(); const running = runPrimeUi(options, plainPalette, term.io, savedDraft()); await wait(term, "PLAN WITH PRIME"); term.input.write("p"); await wait(term, "Preview updated"); term.input.write("s\u0015" + JSON.stringify(request.seeds) + "\r"); await wait(term, "Named paths updated"); expect(term.frame()).not.toContain("exact paths only"); term.input.write("p"); await wait(term, "Preview updated");
    term.input.write("g\u0015New goal\r"); await wait(term, "Goal updated"); expect(term.frame()).not.toContain("exact paths only"); term.input.write("s\u0015[]\r"); await wait(term, "Named paths updated"); term.input.write("q"); expect((await running).request).toEqual({ intent: "New goal", seeds: [] });
  });
  it("refuses a blank-goal preview and refreshes its draft without running Prime or creating a store", async () => {
    const preview = vi.spyOn(prime, "primeFor"); const term = terminal(); const running = runPrimeUi(options, plainPalette, term.io); await wait(term, "PLAN WITH PRIME");
    term.input.write("p"); await wait(term, "g sets a goal"); term.input.write("r"); await wait(term, "Refreshed."); expect(preview).not.toHaveBeenCalled(); term.input.write("q"); expect((await running).request).toEqual({ intent: "" }); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps every evidence line reachable through actual PgDown and preserves 60×20 colour geometry, Unicode safety and the pinned status", async () => {
    await history(); const goal = "Fix orders rate limiting 修复 e\u0301\u001b[2J " + Array.from({ length: 30 }, (_, n) => `Goal ${n}: full detail.`).join(" "); const loaded = await loadPrimeUi({ ...request, intent: goal }, options, true); const notice = "/unreadable directory/".repeat(20);
    for (const help of [false, true]) for (const status of ["", notice]) { const plain = renderPrimeUi(loaded, { ...initialState(), help }, 60, 20, plainPalette, status).lines; const colour = renderPrimeUi(loaded, { ...initialState(), help }, 60, 20, ansiPalette, status, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines; expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).toContain("No session started"); expect(plain.join("\n")).not.toContain("\u001b"); }
    const term = terminal(60, 20); const running = runPrimeUi(options, plainPalette, term.io, { ...savedDraft(), request: loaded.request }); await wait(term, "PLAN WITH PRIME"); term.input.write("p"); await wait(term, "Preview updated"); const maxScroll = renderPrimeUi(loaded, initialState(), 60, 20).maxScroll; const content: string[] = []; let scroll = 0;
    for (let page = 0; page < 100; page++) { const visible = body(term.frame().split("\r\n")); const next = Math.min(maxScroll, scroll + 5); content.push(...(next === scroll ? visible : visible.slice(0, next - scroll))); if (next === scroll) break; term.input.write("\u001b[6~"); await new Promise(resolve => setImmediate(resolve)); scroll = next; }
    const text = compact(content.join("")); for (const line of formatPrimeDetails(loaded.preview!.proposal, loaded.preview!.debt)) expect(text).toContain(compact(safeText(line))); term.input.write("q"); await running;
  });
  it("scrolls a document without history filters, and bounds tiny terminals without previewing", async () => {
    const state = { ...initialState(), scroll: 8 }; for (const name of ["return", "e", "o", "s", "d"]) expect(navigatePrime(state, { name }, 0, 30)).toEqual(state); expect(navigatePrime(state, { name: "d", ctrl: true }, 0, 30).scroll).toBe(13); expect(navigatePrime(state, { name: "home" }, 0, 30).scroll).toBe(0); expect(navigatePrime(state, { name: "end" }, 0, 30).scroll).toBe(30);
    const loaded: PrimeUiData = await loadPrimeUi(request, options); for (const [columns, rows] of [[40, 10], [59, 19], [1, 1]]) { const lines = renderPrimeUi(loaded, initialState(), columns!, rows!).lines; expect(lines.length).toBeLessThanOrEqual(Math.max(1, rows! - 1)); expect(lines.every(line => cellWidth(line) <= Math.max(1, columns! - 1))).toBe(true); }
  });
  it.each(["p", "r"])("ignores a late %s completion after Home and re-enters with a cloned draft and no cached proposal", async key => {
    const proposal = await primeFor(request, options); let complete!: (value: typeof proposal) => void; const preview = vi.spyOn(prime, "primeFor").mockImplementation(() => new Promise(resolve => { complete = resolve; })); const term = terminal(); const running = runPrimeUi(options, plainPalette, term.io, savedDraft()); await wait(term, "PLAN WITH PRIME"); term.input.write(key); await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1)); term.input.write("q"); const saved = await running;
    const home = runAppUi({ repo: "app", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame(); complete(proposal); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(before); expect(saved.request).toEqual(request); term.input.write("q"); await home; const reopened = runPrimeUi(options, plainPalette, term.io, saved); await wait(term, "PLAN WITH PRIME"); expect(term.frame()).not.toContain("exact paths only"); expect(preview).toHaveBeenCalledTimes(1); term.input.write("q"); await reopened;
  });
  it("returns through the real Home with goal, seeds and scroll retained, recomputes only on demand and leaves the ledger unchanged", async () => {
    const ledger = await history(); const before = await readFile(ledger); const preview = vi.spyOn(prime, "primeFor"); const goal = "Fix orders rate limiting " + Array.from({ length: 30 }, (_, n) => `Goal ${n}: full detail.`).join(" "); const term = terminal(60, 20); const open = () => term.input.write("m" + "\u001b[B".repeat(5) + "\r"); const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
    await wait(term, "OVERVIEW"); open(); await wait(term, "PLAN WITH PRIME"); term.input.write("g\u0015" + goal + "\r"); await wait(term, "Goal updated"); term.input.write("s\u0015" + JSON.stringify(request.seeds) + "\r"); await wait(term, "Named paths updated"); term.input.write("p"); await wait(term, "Preview updated"); term.input.write("\u001b[6~q"); await wait(term, "OVERVIEW"); open(); await wait(term, "PLAN WITH PRIME"); expect(preview).toHaveBeenCalledTimes(1); expect(term.frame()).not.toContain("exact paths only"); expect(term.frame()).not.toContain("Goal 0:");
    term.input.write("r"); await wait(term, "Refreshed."); expect(preview).toHaveBeenLastCalledWith({ intent: goal, seeds: request.seeds }, expect.objectContaining(options)); term.input.write("\r"); term.input.end(); await running; expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(await readFile(ledger)).toEqual(before);
  });
});
