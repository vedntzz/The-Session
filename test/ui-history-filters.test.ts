import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { renderUi } from "../src/render/tui/screen.js";
import { canReturnHome, initialState, navigate, visibleSessions, type UiState } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, zeroCost, type Session } from "../src/store.js";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return { id, repo: "path:/example", intent: `work ${id}`, scope: ["src"], baseline: [], reality: ["src/a.ts"], drift: [],
    cost: zeroCost(), outcome: "merged", startCommit: "base", startedAt: "2026-09-01T12:00:00Z", endedAt: "2026-09-01T12:30:00Z", ...overrides };
}
const rows = [session("declared-zero", { intentSource: "declared" }), session("declared-outside", { drift: ["test/a.ts"] }),
  session("legacy-zero"), session("primed-outside", { intentSource: "primed", drift: ["test/a.ts"],
    proposal: { rule: "declared-drift-v1", intent: "work primed-outside", scope: ["src"], candidates: [], history: 0, comparable: 0, tracked: 1, omitted: 0 } }),
  session("captured-zero", { intentSource: "captured", scope: [] }), session("captured-outside", { intentSource: "captured", scope: [], drift: ["test/a.ts"] }),
  session("running-zero", { endedAt: null, outcome: "open" }), session("running-outside", { endedAt: null, outcome: "open", drift: ["test/a.ts"] })];
const ids = (state: UiState) => visibleSessions(rows, state).map(row => row.id);
const press = (state: UiState, name: string) => navigate(state, { name, sequence: name }, rows.length, 30);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("History filter controls", () => {
  it("cycles every result and returns to the complete history", () => {
    let state = press(initialState(), "o"); expect(ids(state)).toEqual(["running-zero", "running-outside"]);
    state = press(state, "o"); expect(ids(state)).toEqual(rows.slice(0, 6).map(row => row.id));
    state = press(state, "o"); expect(ids(state)).toEqual([]); state = press(state, "o"); expect(ids(state)).toEqual([]);
    expect(ids(press(state, "o"))).toHaveLength(rows.length);
  });
  it("cycles sources exactly, including older declarations without a source field", () => {
    let state = press(initialState(), "s"); expect(ids(state)).toEqual(["declared-zero", "declared-outside", "legacy-zero", "running-zero", "running-outside"]);
    state = press(state, "s"); expect(ids(state)).toEqual(["primed-outside"]);
    state = press(state, "s"); expect(ids(state)).toEqual(["captured-zero", "captured-outside"]);
    expect(ids(press(state, "s"))).toHaveLength(rows.length);
  });
  it("keeps measured zero outside-plan changes apart from captured and running work", () => {
    const yes = press(initialState(), "d"); const no = press(yes, "d");
    expect(ids(yes)).toEqual(["declared-outside", "primed-outside"]); expect(ids(no)).toEqual(["declared-zero", "legacy-zero"]);
    expect(ids({ ...initialState(), query: "outside:yes" })).toEqual(ids(yes));
    expect(ids({ ...initialState(), query: "outside:no" })).toEqual(ids(no)); expect(ids(press(no, "d"))).toHaveLength(rows.length);
  });
  it("intersects choices with typed filters and refuses invalid values", () => {
    const state = press(press(press(initialState(), "s"), "s"), "d"); expect(ids(state)).toEqual(["primed-outside"]);
    expect(ids({ ...state, query: "source:primed work" })).toEqual(["primed-outside"]);
    for (const query of ["source:captured", "outside:no", "outcome:open", "source:typo"]) expect(ids({ ...state, query })).toEqual([]);
    for (const filter of ["source", "outside", "outcome"] as const) expect(ids({ ...initialState(), [filter]: 99 })).toEqual([]);
    expect(canReturnHome(state)).toBe(false); const cleared = press(state, "escape"); expect(canReturnHome(cleared)).toBe(true); expect(ids(cleared)).toHaveLength(rows.length);
  });
  it("resets the row position and evidence while preserving the expansion preference", () => {
    for (const name of ["o", "s", "d"]) {
      const state = press({ ...initialState(), selected: 4, scroll: 20, evidence: true, expanded: false }, name);
      expect(state).toMatchObject({ selected: 0, scroll: 0, evidence: false, expanded: false });
    }
  });
  it("treats filter letters as search text and keeps Ctrl-D and Help behavior", () => {
    let state = { ...initialState(), searching: true }; for (const name of ["o", "s", "d"]) state = press(state, name);
    expect(state).toMatchObject({ query: "osd", outcome: 0, source: 0, outside: 0 });
    for (const name of ["o", "s"]) expect(navigate(initialState(), { name, ctrl: true }, rows.length, 30)).toMatchObject({ outcome: 0, source: 0, outside: 0 });
    expect(navigate(initialState(), { name: "d", ctrl: true }, rows.length, 30)).toMatchObject({ scroll: 5, outside: 0 });
    for (const name of ["o", "s", "d"]) expect(press({ ...initialState(), help: true }, name)).toMatchObject({ help: true, outcome: 0, source: 0, outside: 0 });
  });
  it("shows all choices within a small terminal with identical colourless geometry", () => {
    const state = press(press(press(initialState(), "s"), "s"), "d"); const data = { sessions: rows, repo: "example", rates: new Map() };
    for (const value of [initialState(), state]) {
      const plain = renderUi(data, value, 60, 20).lines; const text = plain.join("\n");
      for (const label of ["Result", "Goal source", "Outside plan"]) expect(text).toContain(label);
      expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true);
      const coloured = renderUi(data, value, 60, 20, ansiPalette, "", uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines;
      expect(coloured.map(stripVTControlCharacters)).toEqual(plain);
    }
  });
});

it("preserves keyboard choices and selected work through Home without writing records", async () => {
  vi.stubEnv("TERM", "xterm"); const root = await mkdtemp(path.join(tmpdir(), "session-history-filters-"));
  const cwd = path.join(root, "repo"); const home = path.join(root, "store"); const exec = promisify(execFile);
  try {
    await mkdir(cwd); await exec("git", ["init", "-q", cwd]); await writeFile(path.join(cwd, "a.txt"), "base"); await exec("git", ["-C", cwd, "add", "a.txt"]);
    await exec("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", "base"]);
    const startCommit = (await exec("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
    const options = { cwd, home, adapters: [] }; const now = new Date().toISOString();
    for (const intent of ["first work", "second work"]) await appendSession({ intent, startCommit, startedAt: now, endedAt: now }, options);
    const file = await resolveStoreFile(options); const before = await readFile(file); const input = new PassThrough(); const output = new PassThrough();
    Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns: 110, rows: 32 });
    let text = ""; output.on("data", chunk => { text += String(chunk); }); const frame = () => text.split(screenControl.paint).at(-1) ?? "";
    const wait = async (wanted: string) => { await vi.waitFor(() => expect(frame()).toContain(wanted)); };
    const openHistory = () => input.write("m\u001b[B\u001b[B\r");
    const running = buildProgram({ ...options, palette: plainPalette, appTerminal: { input, output } as unknown as UiTerminal }).parseAsync([], { from: "user" });
    await wait("OVERVIEW"); openHistory(); await wait("all recorded history"); input.write("sdd\u001b[B");
    expect(frame()).toContain("> first work"); const beforeHome = frame(); input.write("q"); await wait("OVERVIEW");
    openHistory(); await wait("all recorded history"); expect(frame()).toBe(beforeHome);
    input.write("q"); await wait("OVERVIEW"); input.write("q"); await running; expect(await readFile(file)).toEqual(before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
