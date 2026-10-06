import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { loadChecked, spendOf, type RateTable } from "../src/pricing.js";
import { loadWeekUi } from "../src/commands/week-ui.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { initialState, navigate } from "../src/render/tui/state.js";
import { cellWidth } from "../src/render/tui/text.js";
import { navigateWeek, renderWeekUi } from "../src/render/tui/week.js";
import { weekCoverage, weekSummary } from "../src/render/tui/week-summary.js";
import { appendSession, resolveStoreFile, zeroCost, type Session, type SessionCost } from "../src/store.js";

const rates: RateTable = new Map([["known", { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 }]]);
const cost = (extra: Partial<SessionCost> = {}): SessionCost => ({ ...zeroCost(), turns: 1, model: "known", ...extra });
const session = (extra: Partial<Session> = {}): Session => ({ id: "work", repo: "path:/example", intent: "ship work", scope: [], baseline: [],
  reality: [], drift: [], cost: cost(), outcome: "merged", startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", ...extra });
const summary = (sessions: Session[]) => weekSummary(sessions, true).map(line => line.text).join("\n");
const data = (sessions: Session[]) => ({ sessions, rates, repo: "example", branch: "main", days: 7, checked: "2026-10-01" });
const text = (sessions: Session[]) => renderWeekUi(data(sessions), { ...initialState(), usage: true, expanded: false }, 110, 60).lines.join("\n");
const tokenLabels = ["Input tokens", "Cache read tokens", "Cache creation tokens", "Output tokens"];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Week totals preserve measurement boundaries", () => {
  it("distinguishes captured zero counters from empty groups and records with calls but no turns", () => {
    const measured = summary([session()]); expect(measured).toContain("Turns: 1");
    for (const label of tokenLabels) expect(measured).toContain(`${label}: 0`);
    expect(measured).toContain("Turns that changed no files: 1"); expect(weekSummary([], true)).toEqual([]);
    for (const sessions of [[session({ cost: cost({ turns: 0, apiCalls: 7, inputTokens: 100 }) })], [session(), session({ cost: zeroCost() })]]) {
      const result = summary(sessions); expect(result).toContain("Turns: not fully captured");
      for (const label of tokenLabels) expect(result).toContain(`${label}: not fully captured`);
      expect(result).toContain("Turns that changed no files: not measured");
      expect(result).toContain(sessions.length === 1 ? "Usage captured: 0/1 sessions." : "Usage captured: 1/2 sessions.");
    }
  });
  it("keeps four captured counters without a known price, but refuses partial or wholly missing token totals", () => {
    const unknown = session({ cost: cost({ model: "future-model", inputTokens: 11, cacheReadTokens: 12, cacheCreationTokens: 13, outputTokens: 14 }) });
    tokenLabels.forEach((label, index) => expect(summary([unknown])).toContain(`${label}: ${11 + index}`));
    for (const untokenedTurns of [1, 3]) {
      const result = summary([session({ cost: cost({ turns: 3, untokenedTurns, inputTokens: 10 }) })]);
      expect(result).toContain("Turns: 3"); for (const label of tokenLabels) expect(result).toContain(`${label}: not fully captured`);
    }
  });
  it("counts repeated paths per finished session and excludes running or captured drift", () => {
    const finished = session({ reality: ["src/shared.ts"], drift: ["src/shared.ts"] });
    const result = summary([finished, session({ reality: ["src/shared.ts"] }), session({ endedAt: null, reality: ["a", "b"], drift: ["a", "b"] })]);
    expect(result).toContain("File changes: 2 across 2 finished sessions (counted per session).");
    expect(result).toContain("Outside plan: 1 file change across 2 finished declarations.");
    expect(result).toContain("1 running session: file changes and drift not measured yet.");
    expect(result).toContain("Turns that changed no files: not measured");
    expect(summary([session({ ...finished, intentSource: "captured" })])).toContain("Outside plan: not measured; no finished declaration.");
    expect(summary([session({ endedAt: null })])).toContain("File changes: not measured; all sessions are running.");
  });
  it("uses the git reconciliation rule for legacy empty turns, including refuted data", () => {
    for (const [reality, emptySource, emptyTurns, expected] of [
      [[], "tools", 0, "3"], [["a"], "tools", 3, "not measured"], [["a"], "tools", 1, "1"], [["a"], "git", 0, "not measured"],
    ] as const) expect(summary([session({ reality: [...reality], cost: cost({ turns: 3, emptySource, emptyTurns }) })])).toContain(`Turns that changed no files: ${expected}`);
  });
  it("explains named pricing gaps, missing capture and missing tokens without inventing a price", () => {
    const sessions = [session({ cost: cost({ model: "future-model", inputTokens: 2 }) }), session({ cost: zeroCost() }), session({ cost: cost({ untokenedTurns: 1 }) })];
    const lines = weekCoverage(spendOf(sessions, rates), sessions).map(line => line.text).join("\n");
    expect(lines).toContain("future-model"); expect(lines).toContain("uncaptured: no turns on the record");
    expect(lines).toContain("no recorded token counts."); expect(lines).not.toContain("$");
  });
  it("renders source totals separately and opens a later selection at its source summary", () => {
    const sessions = [session({ id: "first", cost: cost({ turns: 2 }) }), session({ id: "second", cost: cost({ turns: 3 }) }), session({ id: "prompt", intentSource: "captured", cost: cost({ turns: 7 }) })];
    const rendered = text(sessions); expect(rendered).toContain("Turns: 5"); expect(rendered).toContain("Turns: 7"); expect(rendered).not.toContain("Turns: 12");
    const state = navigateWeek({ ...initialState(), selected: 1, scroll: 20, expanded: false }, { name: "u" }, 3, 30);
    expect(state).toMatchObject({ selected: 1, usage: true, scroll: 0, expanded: false });
    const top = renderWeekUi(data(sessions), state, 110, 24).lines.join("\n"); expect(top).toContain("declared · 2 sessions"); expect(top).toContain("USAGE TOTALS");
  });
  it("shows a checked date only for an actual priced figure, including measured zero", () => {
    expect(text([session()])).toContain("$0.00 spent"); expect(text([session()])).toContain("prices checked 2026-10-01");
    const unknown = session({ cost: cost({ model: "future-model", inputTokens: 1 }) });
    for (const sessions of [[], [session({ cost: zeroCost() })], [unknown], [session(), unknown]]) expect(text(sessions)).not.toContain("prices checked");
    expect(text([session({ cost: cost({ inputTokens: 1_000_000 }) }), unknown])).toContain("prices checked 2026-10-01");
  });
  it("fits usage controls, typed chips and pricing notes at 60×20 with identical colour geometry", () => {
    const queries = ["", "source:declared outside:no outcome:merged", "source:declared source:primed source:captured outside:yes outside:no outcome:open outcome:merged outcome:abandoned outcome:empty"];
    for (const query of queries) for (const searching of [false, true]) {
      const input = data([session()]); const state = { ...initialState(), usage: true, query, searching };
      const plain = renderWeekUi(input, state, 60, 20).lines;
      const colour = renderWeekUi(input, state, 60, 20, ansiPalette, "", uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines;
      expect(plain.length).toBeLessThanOrEqual(19); expect(plain.every(line => cellWidth(line) <= 59)).toBe(true);
      expect(colour.map(stripVTControlCharacters)).toEqual(plain); for (const key of ["w", "u", "o", "s", "d"]) expect(plain.join("\n")).toContain(`[${key}]`);
      expect(plain.join("\n")).toContain("│ >"); if (query !== queries[2]) expect(plain.join("\n")).toContain("prices checked");
    }
  });
  it("keeps search, Help and Ctrl-U semantics while changing only the Week preference", () => {
    const state = { ...initialState(), scroll: 10 }; expect(navigate(state, { name: "u" }, 1, 30).usage).toBe(false);
    expect(navigateWeek(state, { name: "u", ctrl: true }, 1, 30)).toMatchObject({ usage: false, scroll: 5 });
    expect(navigateWeek({ ...state, help: true }, { name: "u" }, 1, 30).usage).toBe(false);
    expect(navigateWeek({ ...state, searching: true }, { name: "u", sequence: "u" }, 1, 30)).toMatchObject({ query: "u", usage: false });
    expect(navigateWeek({ ...state, usage: true }, { name: "s" }, 1, 30)).toMatchObject({ usage: true, source: 1, scroll: 0 });
  });
  it("persists usage through range changes and Home reentry without rewriting the ledger", async () => {
    vi.stubEnv("TERM", "xterm"); const root = await mkdtemp(path.join(tmpdir(), "session-week-summary-"));
    const options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] };
    try {
      await mkdir(options.cwd); const time = new Date().toISOString(); await appendSession({ intent: "recorded work", startedAt: time, endedAt: time, startCommit: "base", cost: cost() }, options);
      const file = await resolveStoreFile(options); const before = await readFile(file); expect((await loadWeekUi(7, options)).checked).toBe(await loadChecked());
      const input = new PassThrough(); const output = new PassThrough(); Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() }); Object.assign(output, { isTTY: true, columns: 110, rows: 60 });
      let rendered = ""; output.on("data", chunk => { rendered += String(chunk); }); const frame = () => rendered.split(screenControl.paint).at(-1) ?? "";
      const wait = async (value: string) => { await vi.waitFor(() => expect(frame()).toContain(value)); };
      const running = buildProgram({ ...options, appTerminal: { input, output } as unknown as UiTerminal, palette: plainPalette }).parseAsync([], { from: "user" });
      const openWeek = () => input.write("m\u001b[B\u001b[B\u001b[B\r");
      await wait("OVERVIEW"); openWeek(); await wait("last 7 days"); input.write("uw"); await wait("last 14 days"); input.write("s");
      expect(frame()).toContain("[u] Usage: hide"); expect(frame()).toContain("USAGE TOTALS"); input.write("q"); await wait("OVERVIEW");
      openWeek(); await wait("last 14 days"); expect(frame()).toContain("[u] Usage: hide"); expect(frame()).toContain("Goal source: declared"); expect(frame()).toContain("USAGE TOTALS");
      input.write("q"); await wait("OVERVIEW"); input.write("q"); await running; expect(await readFile(file)).toEqual(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
