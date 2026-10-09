import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { loadOutcomesUi, outcomesUiActions } from "../src/commands/outcomes-ui.js";
import * as settle from "../src/commands/settle.js";
import * as sweep from "../src/commands/sweep.js";
import { runUiBrowser, type UiTerminal } from "../src/commands/ui.js";
import { verifyLog } from "../src/commands/verify.js";
import * as observe from "../src/observe.js";
import { effectiveOutcome, judge, preexistingKey, type Observation, type RepoFacts } from "../src/outcome.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { UI_MENU } from "../src/render/tui/menu.js";
import { renderOutcomesUi, type OutcomesUiData } from "../src/render/tui/outcomes.js";
import { initialState, SCROLL_STEP, visibleSessions } from "../src/render/tui/state.js";
import { cellWidth, safeText } from "../src/render/tui/text.js";
import * as store from "../src/store.js";
import { isIntact } from "../src/verify.js";

const session = (over: Partial<store.Session> = {}): store.Session => ({ id: "one", repo: "path:/local", intent: "First goal", scope: ["src"], baseline: [], reality: ["src/a.ts"], drift: [], endState: { "src/a.ts": "blob" }, outcome: "open", startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", cost: store.zeroCost(), ...over });
const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({ branch: "main", tip: "checked-tip", history: new Map(), working: new Map(), absentAtTip: new Set(), ...over });
const seen = (over: Partial<Observation> = {}): Observation => ({ outcome: "merged", observedAt: "2026-10-02T12:00:00Z", source: "computed", branch: "main", commit: "old-tip", ...over });
const data = (sessions = [session()], against: RepoFacts | undefined = facts()): OutcomesUiData => ({ repo: "local", branch: against?.branch, tip: against?.tip, sessions: sessions.map(record => observe.resolveOutcome(record, against)), decisions: new Map(sessions.map(record => [record.id, settle.settlementDecision(record, against)])) });
const browser = { returnToHome: true, render: renderOutcomesUi, select: (input: OutcomesUiData, state: ReturnType<typeof initialState>) => visibleSessions(input.sessions, state) };
const render = (input: OutcomesUiData, state = initialState()) => renderOutcomesUi(input, state, 160, 300).lines.join("\n");
const compact = (text: string) => text.replace(/\s/gu, "");
function terminal(columns = 110, rows = 40) {
  const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); }); return { input, output, io: { input, output } as unknown as UiTerminal, frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
const wait = async (term: ReturnType<typeof terminal>, text: string) => { await vi.waitFor(() => expect(term.frame()).toContain(text)); };
let root: string; let options: { cwd: string; home: string; adapters: never[] };
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-ui-outcomes-")); options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const git = async (...args: string[]) => (await promisify(execFile)("git", ["-C", options.cwd, ...args])).stdout.trim();
async function fixture() {
  await git("init", "-q", "-b", "main"); await git("-c", "user.name=QA", "-c", "user.email=qa@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "--no-verify", "-qm", "baseline");
  const base = await git("rev-parse", "HEAD");
  const records = [];
  for (const id of ["one", "two"]) {
    const file = `${id}.ts`; await writeFile(path.join(root, file), `content ${id}`); const hash = await git("hash-object", path.join(root, file));
    const created = await store.appendSession({ id, intent: `${id} goal`, scope: [file], startCommit: base, startedAt: "2026-10-01T12:00:00Z", endedAt: null }, options);
    const patch = { endedAt: "2026-10-01T13:00:00Z", reality: [file], endState: { [file]: hash } };
    records.push(await store.updateSession(created.id, patch, options));
    expect((await store.readSessions(options)).find(record => record.id === id)).toMatchObject(patch);
  }
  return { records, ledger: await store.resolveStoreFile(options) };
}
async function land(id = "one") { await writeFile(path.join(options.cwd, `${id}.ts`), `content ${id}`); await git("add", `${id}.ts`); await git("-c", "user.name=QA", "-c", "user.email=qa@example.test", "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", `land ${id}`); }

describe("Work outcomes workspace", () => {
  it("shares native guard precedence, terminal verdicts and last-observation idempotence", () => {
    const against = facts({ history: new Map([["src/a.ts", new Set(["blob"])]]) });
    for (const [record, reason] of [[session({ endedAt: null }), "stillOpen"], [session({ reality: [] }), "empty"], [session({ endState: undefined }), "undecidable"]] as const) expect(settle.settlementDecision(record, against)).toEqual({ skipped: reason });
    expect(settle.settlementDecision(session(), undefined)).toEqual({ skipped: "undecidable" }); const inFlight = facts({ working: new Map([["src/a.ts", "blob"]]) }); expect(settle.settlementDecision(session(), inFlight)).toEqual({ skipped: "stillOpen", verdict: judge(session(), inFlight) }); expect(render(data([session()], inFlight))).toContain('In flight: "src/a.ts"');
    for (const record of [session(), session({ observations: [seen()] }), session({ observations: [seen({ outcome: "abandoned" })] })]) expect(settle.settlementDecision(record, against)).toEqual({ outcome: effectiveOutcome(record, against), verdict: judge(record, against), against: { branch: "main", tip: "checked-tip" }, wouldRecord: record.observations?.at(-1)?.outcome !== "merged" });
  });
  it("retains manual precedence, deletion evidence and the native preexisting-content exclusion", () => {
    const manual = session({ observations: [seen({ source: "manual" })] }); expect(settle.settlementDecision(manual, facts())).toMatchObject({ outcome: "merged", wouldRecord: false, verdict: { outcome: "abandoned" } }); expect(render(data([manual]))).toContain("Manual override preserved: merged");
    const deleted = session({ endState: { "src/a.ts": null } }); expect(settle.settlementDecision(deleted, facts({ history: new Map([["src/a.ts", new Set(["old"])]]), absentAtTip: new Set(["src/a.ts"]) }))).toMatchObject({ outcome: "merged" });
    const prior = facts({ history: new Map([["src/a.ts", new Set(["blob"])]]), preexisting: new Set([preexistingKey("one", "src/a.ts")]) }); expect(settle.settlementDecision(session(), prior)).toMatchObject({ outcome: "abandoned" });
  });
  it("loads fresh reported outcomes and read-only decisions without a sweep or ledger writes", async () => {
    const source = await fixture(); const before = await readFile(source.ledger); const swept = vi.spyOn(sweep, "sweepFirst"); const writes = vi.spyOn(store, "updateSession"); const input = await loadOutcomesUi(options); const records = await store.readSessions(options); const against = await observe.factsFor(records, options.cwd);
    expect(input.sessions).toEqual(records.map(record => observe.resolveOutcome(record, against)).reverse()); expect([...input.decisions]).toEqual(records.map(record => [record.id, settle.settlementDecision(record, against)]));
    expect(render(input)).toContain("Current outcome: open"); expect(render(input)).toContain("Ready to record: abandoned (computed observation)"); expect(swept).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(await readFile(source.ledger)).toEqual(before);
  });
  it("keeps empty, unknown, no-match and invalid-search states distinct without creating a store", async () => {
    const input = await loadOutcomesUi(options); await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" }); expect(render(input)).toContain("No sessions recorded for this repository");
    expect(render(data([session({ reality: [] })]))).toContain("Changed no files; no outcome observation is needed"); expect(render(data([session({ endState: undefined })]))).toContain("Unknown: end states were not recorded");
    expect(render(data(), { ...initialState(), query: "missing" })).toContain("No matching sessions"); expect(render(data(), { ...initialState(), query: "outcome:invalid" })).toContain("outcome: use open / merged / abandoned / empty");
  });
  it("requires the exact confirmation and refuses an aborted action before writes", async () => {
    const source = await fixture(); const input = await loadOutcomesUi(options); const before = await readFile(source.ledger); const action = outcomesUiActions(options)[0]!;
    for (const value of ["", "Record", " record", "record\n"]) await expect(action.run(input, initialState(), value)).rejects.toThrow("Type record exactly");
    const abort = new AbortController(); abort.abort(); await expect(action.run(input, initialState(), "record", abort.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(await readFile(source.ledger)).toEqual(before);
    const original = structuredClone(input); let complete!: (result: settle.SettleResult) => void; vi.spyOn(settle, "settleSessions").mockImplementation(() => new Promise(resolve => { complete = resolve; })); vi.spyOn(observe, "factsFor").mockResolvedValueOnce(facts({ branch: "late-branch", tip: "late-tip" }));
    const late = new AbortController(); const pending = action.run(input, initialState(), "record", late.signal); late.abort(); complete({ branch: "main", settled: [], stillOpen: 0, empty: 0, undecidable: 0 }); await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(input).toEqual(original); expect(await readFile(source.ledger)).toEqual(before);
  });
  it("records fresh evidence for all sessions despite filters, preserving immutable bytes and idempotence", async () => {
    const source = await fixture(); const input = await loadOutcomesUi(options); const original = structuredClone(input); const before = await readFile(source.ledger); await land(); const tip = await git("rev-parse", "HEAD"); const action = outcomesUiActions(options)[0]!;
    const result = await action.run(input, { ...initialState(), query: "one" }, "record"); if (typeof result === "string") throw new Error("Expected fresh outcomes data"); expect(input).toEqual(original); expect(result.data).toEqual(await loadOutcomesUi(options)); const after = await readFile(source.ledger); expect(after.subarray(0, before.length)).toEqual(before); const records = await store.readSessions(options);
    expect(records.map(record => record.observations?.at(-1))).toEqual([seen({ outcome: "merged", commit: tip, observedAt: expect.any(String) }), seen({ outcome: "abandoned", commit: tip, observedAt: expect.any(String) })]);
    for (const [index, record] of records.entries()) for (const key of ["intent", "scope", "startCommit", "checkout", "intentSource", "proposal", "agreement"] as const) expect(record[key]).toEqual(source.records[index]![key]);
    expect(records.every(record => !record.survival && record.observations?.every(item => item.source === "computed"))).toBe(true); expect(result.data.sessions.find(record => record.id === "one")?.outcome).toBe("merged"); expect(result.data.sessions.find(record => record.id === "two")?.outcome).toBe("open"); const checked = await verifyLog(options); expect(isIntact(checked.check)).toBe(true); expect(checked.check.signaturesChecked).toBe(true);
    await action.run(result.data, initialState(), "record"); expect(await readFile(source.ledger)).toEqual(after);
  });
  it("stops before the next signed append after abort while retaining the completed observation", async () => {
    const source = await fixture(); const before = await readFile(source.ledger); const abort = new AbortController(); const update = store.updateSession;
    vi.spyOn(store, "updateSession").mockImplementation(async (...args) => { const record = await update(...args); abort.abort(); return record; });
    await expect(settle.settleSessions(options, undefined, abort.signal)).rejects.toMatchObject({ name: "AbortError" }); const records = await store.readSessions(options); expect(records.filter(record => record.observations?.length)).toHaveLength(1); expect((await readFile(source.ledger)).subarray(0, before.length)).toEqual(before); expect(isIntact((await verifyLog(options)).check)).toBe(true);
  });
  it("reports a failed post-write display reload as recorded observations rather than a write failure", async () => {
    const source = await fixture(); const input = await loadOutcomesUi(options); const native = observe.factsFor; vi.spyOn(observe, "factsFor").mockImplementationOnce(native).mockRejectedValueOnce(new Error("reload unavailable"));
    const message = await outcomesUiActions(options)[0]!.run(input, initialState(), "record"); if (typeof message !== "string") throw new Error("Expected the display-reload recovery notice"); expect(message).toContain("2 sessions recorded"); expect(message).toContain("Display refresh failed: reload unavailable"); expect(message).toContain("r retries"); expect((await store.readSessions(options)).every(record => record.observations?.length === 1)).toBe(true); expect(isIntact((await verifyLog(options)).check)).toBe(true); expect(await readFile(source.ledger)).not.toHaveLength(0);
  });
  it("preserves current selection during a structured action and falls back under a newer filter", async () => {
    const input = data([session({ id: "one", intent: "first" }), session({ id: "two", intent: "second" }), session({ id: "three", intent: "third" })]); const original = structuredClone(input); const replacement = { ...input, sessions: [input.sessions[1]!, input.sessions[2]!, input.sessions[0]!] }; const term = terminal(); let complete!: () => void;
    const action = { key: "w", label: "Refresh action", run: async () => { await new Promise<void>(resolve => { complete = resolve; }); return { message: "done", data: replacement }; } };
    const running = runUiBrowser(input, async () => input, plainPalette, term.io, { ...browser, selectedSessionId: "one", actions: [action] }); term.input.write("w\u001b[B"); expect(term.frame()).toContain("> second"); complete(); await wait(term, "done"); term.input.write("q"); expect(await running).toMatchObject({ selectedSessionId: "two", state: { selected: 0 } }); expect(input).toEqual(original);
    const filtered = terminal(); const second = runUiBrowser(replacement, async () => replacement, plainPalette, filtered.io, { ...browser, selectedSessionId: "one", actions: [{ ...action, run: async () => { await new Promise<void>(resolve => { complete = resolve; }); return { message: "filtered", data: { ...replacement, sessions: replacement.sessions.map(record => record.id === "two" ? { ...record, outcome: "merged" as const } : record) } }; } }] }); filtered.input.write("wo"); complete(); await wait(filtered, "filtered"); filtered.input.write("q"); expect(await second).toMatchObject({ selectedSessionId: "three", state: { selected: 0, outcome: 1 } }); expect(input).toEqual(original);
  });
  it("keeps full Unicode paths, branch, hashes and observation provenance reachable by real paging", async () => {
    const file = "src/修复 e\u0301 \u001b[2J " + "long path ".repeat(20) + "FINAL.ts"; const record = session({ id: "long-id-".repeat(15), reality: [file], endState: { [file]: "blob" }, observations: [seen({ outcome: "abandoned", branch: "long branch ".repeat(14), commit: "old-commit-".repeat(12) })] }); const against = facts({ branch: "checked branch ".repeat(12), tip: "checked-tip-".repeat(12) }); const input = data([record], against); const notice = "Read failed: " + "/long recovery path/".repeat(16);
    for (const state of [initialState(), { ...initialState(), help: true }, { ...initialState(), query: "source:declared outside:no outcome:open" }]) for (const status of ["", notice]) { const plain = renderOutcomesUi(input, state, 60, 20, plainPalette, status).lines; const colour = renderOutcomesUi(input, state, 60, 20, ansiPalette, status, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines; expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true); expect(colour.map(stripVTControlCharacters)).toEqual(plain); expect(plain.join("\n")).not.toContain("\u001b"); }
    const term = terminal(60, 20); const running = runUiBrowser(input, async () => input, plainPalette, term.io, browser); const pages: string[] = []; const body = () => { const lines = term.frame().split("\r\n"); return lines.slice(lines.findIndex(line => line.includes("> / Search sessions or files")) + 1, lines.findLastIndex(line => /^─+$/u.test(line.trim()))); }; const limit = renderOutcomesUi(input, initialState(), 60, 20).maxScroll;
    for (let scroll = 0; scroll < limit;) { const advanced = Math.min(SCROLL_STEP, limit - scroll); pages.push(...body().slice(0, advanced)); term.input.write("\u001b[6~"); await new Promise(resolve => setImmediate(resolve)); scroll += advanced; } pages.push(...body()); term.input.write("q"); await running;
    const text = compact(pages.join("")); for (const value of [JSON.stringify(file), record.id, against.branch, against.tip, ...record.observations!.map(item => `Observed ${item.observedAt} · ${item.outcome} · ${item.source} · branch ${item.branch} · commit ${item.commit}`)]) expect(text).toContain(compact(safeText(value)));
    const tiny = renderOutcomesUi(input, initialState(), 10, 5).lines; expect(tiny.length).toBeLessThanOrEqual(4); expect(tiny.every(line => cellWidth(line) <= 9)).toBe(true);
  });
  it("guards recording in search, Help, Ctrl and paste, cancels input, and ignores late completion after Home", async () => {
    const input = data(); const original = structuredClone(input); const term = terminal(); let complete!: () => void; const native = outcomesUiActions(options)[0]!; const run = vi.fn(async (_data: OutcomesUiData, _state: ReturnType<typeof initialState>, value?: string, _signal?: AbortSignal) => { await new Promise<void>(resolve => { complete = resolve; }); return { message: value ?? "done", data: data([session({ id: "late", intent: "Late replacement" })]) }; });
    const running = runUiBrowser(input, async () => input, plainPalette, term.io, { ...browser, actions: [{ ...native, run }] }); term.input.write("?w?"); term.input.emit("keypress", "", { name: "w", ctrl: true }); term.input.write("\u001b[200~w\u001b[201~"); term.input.write("/w"); expect(run).not.toHaveBeenCalled(); term.input.emit("keypress", "", { name: "escape" }); term.input.write("w"); term.input.emit("keypress", "", { name: "escape" }); expect(run).not.toHaveBeenCalled();
    term.input.write("w\u001b[200~record\r\u001b[201~"); expect(run).not.toHaveBeenCalled(); term.input.write("\r"); expect(run).toHaveBeenCalledWith(input, expect.any(Object), "record", expect.any(AbortSignal)); term.input.write("q"); expect(await running).toMatchObject({ selectedSessionId: "one" }); expect(run.mock.calls[0]![3]!.aborted).toBe(true); const home = runAppUi({ repo: "local", branch: "main", home: {} }, plainPalette, term.io); const frame = term.frame(); complete(); await new Promise(resolve => setImmediate(resolve)); expect(term.frame()).toBe(frame); expect(input).toEqual(original); term.input.write("q"); await home;
  });
  it("retains real Home search, selection and scroll after read-only refresh with clean terminal ownership", async () => {
    const source = await fixture(); const before = await readFile(source.ledger); const signals = process.listeners("SIGTERM"); const term = terminal(60, 20); const open = () => term.input.write("m" + "\u001b[B".repeat(UI_MENU.findIndex(item => item.screen === "outcomes")) + "\r"); const running = buildProgram({ ...options, appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
    await wait(term, "OVERVIEW"); open(); await wait(term, "WORK OUTCOMES"); term.input.write("/one\rr"); await wait(term, "Refreshed."); term.input.write("\u001b[6~"); const frame = term.frame().split("\r\n").slice(0, -1); term.input.write("q"); await wait(term, "OVERVIEW"); open(); await wait(term, "WORK OUTCOMES"); expect(term.frame().split("\r\n").slice(0, -1)).toEqual(frame); term.input.end(); await running;
    expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(process.listeners("SIGTERM")).toEqual(signals); expect(await readFile(source.ledger)).toEqual(before);
  });
});
