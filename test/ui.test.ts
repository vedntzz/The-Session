import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { ansiPalette, plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { renderUi, type UiData } from "../src/render/tui/screen.js";
import { initialState, navigate, visibleSessions, parseQuery } from "../src/render/tui/state.js";
import { cellWidth, safeText } from "../src/render/tui/text.js";
import { zeroCost, type Session } from "../src/store.js";

beforeEach(() => { vi.stubEnv("TERM", "xterm-256color"); });
afterEach(() => { vi.unstubAllEnvs(); });

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555", repo: "path:/example",
    intent: "Add rate limiting", scope: ["src/api"], baseline: [],
    reality: ["src/api/orders.ts", "test/orders.ts"], drift: ["test/orders.ts"],
    cost: { ...zeroCost(), model: "test", turns: 3, inputTokens: 1000, emptySource: "git" },
    outcome: "merged", startCommit: "abc123", startedAt: "2026-09-17T12:00:00Z",
    endedAt: "2026-09-17T12:30:00Z", ...overrides,
  };
}

function data(sessions = [session()]): UiData {
  return { sessions, repo: "example", days: 7, rates: new Map([
    ["test", { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 }],
  ]) };
}

describe("terminal UI", () => {
  it.each([[60, 20], [80, 24], [110, 24], [140, 40]])("fits %i by %i, with identical plain and colour geometry", (columns, rows) => {
    const input = data([session({ intent: "修复 café " + "long intent ".repeat(15) }), session({ outcome: "abandoned" }), session({ outcome: "empty" }), session({ outcome: "open" })]);
    const plain = renderUi(input, initialState(), columns, rows).lines;
    const coloured = renderUi(input, initialState(), columns, rows, ansiPalette, "", uiThemeFor({ isTTY: true, env: { COLORTERM: "truecolor" } })).lines;
    expect(plain.length).toBeLessThanOrEqual(rows - 1);
    expect(plain.every((line) => cellWidth(line) <= columns - 1)).toBe(true);
    expect(coloured.map(stripVTControlCharacters)).toEqual(plain);
    expect(plain.join("\n")).toContain("THE SESSION");
    expect(plain.join("\n")).toContain("FILTERS");
  });

  it("keeps unknown usage, no scope and empty sessions distinct from zero", () => {
    const input = data([session({ intentSource: "captured", scope: [], drift: [], cost: zeroCost() })]);
    const frame = renderUi(input, initialState(), 160, 65).lines.join("\n");
    expect(frame).toContain("No scope");
    expect(frame).toContain("Not captured; cost and turns are unknown.");
    expect(frame).toContain("nothing here could be priced");
    expect(frame).not.toContain("$0.00");
    const empty = data([session({ outcome: "empty", reality: [], drift: [], cost: { ...zeroCost(), model: "test", turns: 2, emptyTurns: 2, emptySource: "git" } })]);
    const rendered = renderUi(empty, { ...initialState(), evidence: true }, 160, 65).lines.join("\n");
    expect(rendered).toContain("1 changed no files");
    expect(rendered).toContain("2 turns changed no files");
    expect(rendered).toContain("$0.00 spent");
  });

  it("makes full intent, drift paths, and unpriced models reachable in details", () => {
    const input = data([session({ intent: "a".repeat(200) + "LAST WORD", cost: { ...zeroCost(), turns: 1, model: "unknown-model" } })]);
    let state = { ...initialState(), evidence: true };
    const first = renderUi(input, state, 110, 24);
    const pages: string[] = [];
    for (let scroll = 0; scroll <= first.maxScroll; scroll++) {
      state = { ...state, scroll };
      pages.push(renderUi(input, state, 110, 24).lines.join("\n"));
    }
    expect(pages.join("\n")).toContain("LAST WORD");
    expect(pages.join("\n")).toContain("! orders.ts");
    expect(pages.join("\n")).toContain("unpriced (unknown-model)");
    expect(pages.join("\n")).toContain("Turns that changed no files: not measured");
  });

  it("filters by path and outcome, and clamps navigation and scrolling", () => {
    const sessions = [session(), session({ id: "other", outcome: "open", reality: ["README.md"] })];
    let state = navigate(initialState(), { name: "down" }, 2, 20);
    expect(state.selected).toBe(1);
    state = navigate(state, { name: "down" }, 2, 20);
    expect(state.selected).toBe(1);
    state = navigate(state, { sequence: "/" }, 2, 20);
    state = navigate(state, { sequence: "README" }, 2, 20);
    expect(visibleSessions(sessions, state).map((row) => row.id)).toEqual(["other"]);
    state = navigate(state, { name: "escape" }, 1, 20);
    state = navigate(state, { name: "o" }, 2, 20);
    expect(visibleSessions(sessions, state).map((row) => row.id)).toEqual(["other"]);
    state = navigate(state, { name: "pagedown" }, 1, 20);
    state = navigate(state, { name: "pagedown" }, 1, 20);
    state = navigate(state, { name: "pagedown" }, 1, 20);
    state = navigate(state, { name: "pagedown" }, 1, 20);
    expect(state.scroll).toBe(20);
    expect(navigate(state, { name: "pagedown" }, 1, 20).scroll).toBe(20);
  });

  it("removes record-supplied terminal commands and control characters", () => {
    expect(safeText("hello\u001b[2J\u001b]0;bad title\u0007\rworld")).toBe("hello world");
    const frame = renderUi(data([session({ intent: "hello\u001b[2J\u0000world" })]), initialState(), 110, 30).lines.join("\n");
    expect(frame).not.toContain("\u001b");
    expect(frame).not.toContain("\u0000");
  });

  it("explains small terminals and no matching records", () => {
    expect(renderUi(data(), initialState(), 50, 15).lines.join()).toContain("Resize");
    expect(renderUi(data(), { ...initialState(), query: "missing" }, 120, 24).lines.join()).toContain("No matches");
    expect(renderUi(data([]), initialState(), 120, 24).lines.join()).toContain("No sessions");
  });

  it("registers ui without growing the short help list", () => {
    const program = buildProgram();
    expect(program.commands.find((command) => command.name() === "ui")?.helpInformation()).toContain("--days");
    expect(program.helpInformation()).not.toMatch(/^\s+ui\s/m);
  });

  it("combines structured filters with text, without treating unknown drift as zero", () => {
    const sessions = [session(), session({ id: "zero", drift: [] }),
      session({ id: "captured", intentSource: "captured", scope: [], drift: [] }),
      session({ id: "running", endedAt: null, outcome: "open", drift: [] })];
    const find = (query: string): string[] => visibleSessions(sessions, { ...initialState(), query }).map((row) => row.id);
    expect(find("outside:yes outcome:merged source:declared rate")).toEqual([sessions[0]!.id]);
    expect(find("outside:no")).toEqual(["zero"]);
    expect(find("outside:yes source:captured")).toEqual([]);
    expect(find("outside:maybe")).toEqual([]);
    expect(parseQuery("source:unknown").error).toContain("declared / primed / captured");
  });

  it("expands inline, reveals evidence on demand, and pages through help", () => {
    const input = data();
    let state = initialState();
    expect(renderUi(input, state, 120, 50).lines.join("\n")).not.toContain("Start commit");
    state = navigate(state, { name: "e" }, 1, 50);
    expect(renderUi(input, state, 120, 65).lines.join("\n")).toContain("Start commit abc123");
    state = navigate(state, { name: "return" }, 1, 50);
    expect(renderUi(input, state, 120, 40).lines.join("\n")).not.toContain("CHANGED FILES");
    state = navigate(state, { sequence: "?" }, 1, 50);
    const help = renderUi(input, state, 80, 24);
    expect(help.lines.join("\n")).toContain("KEYBOARD");
    state = navigate(state, { name: "pagedown" }, 1, help.maxScroll);
    expect(state.scroll).toBeGreaterThan(0);
    state = navigate(state, { name: "escape" }, 1, help.maxScroll);
    expect(state.help).toBe(false);
    expect(state.scroll).toBe(0);
  });

  it("paints the approved theme only where supported, with colourless and basic fallbacks", () => {
    const rgb = uiThemeFor({ isTTY: true, env: { COLORTERM: "truecolor" } });
    expect(rgb.background).toBe("\u001b[48;2;17;19;29m");
    expect(rgb.paint("selected", "focus", true)).toContain("48;2;27;32;51");
    expect(rgb.paint("focus", "focus")).toContain("38;2;155;167;245");
    const off = uiThemeFor({ isTTY: true, env: { NO_COLOR: "1", COLORTERM: "truecolor" } });
    expect(off.background).toBe("");
    expect(off.paint("text", "focus", true)).toBe("text");
    const basic = uiThemeFor({ isTTY: true, env: { TERM: "xterm" } });
    expect(basic.paint("text", "focus", true)).not.toContain("38;2");
    expect(stripVTControlCharacters(basic.paint("text", "focus", true))).toBe("text");
  });
});

function terminal(): { io: UiTerminal; input: PassThrough; output: PassThrough; raw: ReturnType<typeof vi.fn>; text: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw });
  Object.assign(output, { isTTY: true, columns: 120, rows: 30 });
  let text = "";
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); });
  return { io: { input, output } as unknown as UiTerminal, input, output, raw, text: () => text };
}

describe("terminal lifecycle", () => {
  it("decodes input, refreshes, resizes, and restores the terminal on quit", async () => {
    const term = terminal();
    const refresh = vi.fn(async () => data([session({ intent: "Updated record" })]));
    const running = runUi(data(), refresh, plainPalette, term.io);
    term.input.write("r");
    await new Promise((resolve) => setImmediate(resolve));
    expect(refresh).toHaveBeenCalledOnce();
    expect(term.text()).toContain("Updated record");
    term.output.emit("resize");
    term.input.write("q");
    await running;
    expect(term.raw.mock.calls).toEqual([[true], [false]]);
    expect(term.text()).toContain(screenControl.enter);
    expect(term.text()).toContain(screenControl.leave);
    expect(term.input.isPaused()).toBe(true);
    expect(term.input.listenerCount("keypress")).toBe(0);
    expect(term.output.listenerCount("resize")).toBe(0);
  });

  it("keeps the previous data on refresh failure and allows quitting during refresh", async () => {
    const term = terminal();
    const running = runUi(data(), async () => { throw new Error("cannot read log"); }, plainPalette, term.io);
    term.input.write("r");
    await new Promise((resolve) => setImmediate(resolve));
    expect(term.text()).toContain("Refresh failed: cannot read log");
    term.input.write("q");
    await running;
    const next = terminal();
    let resolveRefresh!: (value: UiData) => void;
    const second = runUi(data(), () => new Promise((resolve) => { resolveRefresh = resolve; }), plainPalette, next.io);
    next.input.write("r");
    await new Promise((resolve) => setImmediate(resolve));
    next.input.write("q");
    await second;
    const end = next.text();
    resolveRefresh(data());
    await new Promise((resolve) => setImmediate(resolve));
    expect(next.text()).toBe(end);
  });

  it("restores the terminal on input failure", async () => {
    const term = terminal();
    const running = runUi(data(), async () => data(), plainPalette, term.io);
    term.input.emit("error", new Error("input disconnected"));
    await expect(running).rejects.toThrow("input disconnected");
    expect(term.raw).toHaveBeenLastCalledWith(false);
    expect(term.text()).toContain(screenControl.leave);
  });

  it("restores raw mode and signal listeners on Ctrl-C", async () => {
    const term = terminal();
    const before = process.listenerCount("SIGINT");
    const code = process.exitCode;
    try {
      const running = runUi(data(), async () => data(), plainPalette, term.io);
      term.input.write("\u0003");
      await running;
      expect(process.exitCode).toBe(130);
      expect(term.raw).toHaveBeenLastCalledWith(false);
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally { process.exitCode = code; }
  });

  it("refuses piped output before entering raw mode", async () => {
    const term = terminal();
    Object.assign(term.output, { isTTY: false });
    await expect(runUi(data(), async () => data(), plainPalette, term.io)).rejects.toThrow("session week");
    expect(term.raw).not.toHaveBeenCalled();
    expect(term.text()).toBe("");
  });
});
