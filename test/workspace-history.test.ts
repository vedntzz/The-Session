import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { runUi, type UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { plainPalette, screenControl } from "../src/render/palette.js";
import { appendSession } from "../src/store.js";

const exec = promisify(execFile);
const listenersFor = (event: NodeJS.Signals | "exit"): readonly unknown[] => event === "exit" ? process.listeners("exit") : process.listeners(event);
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw });
  Object.assign(output, { isTTY: true, columns: 110, rows: 32 });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, raw, io: { input, output } as unknown as UiTerminal,
    frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of await readdir(dir, { recursive: true })) {
    const full = path.join(dir, name);
    if ((await stat(full)).isFile()) files[name] = (await readFile(full)).toString("base64");
  }
  return files;
}

describe("History inside the Session workspace", () => {
  let root: string; let cwd: string; let home: string; let startCommit: string;
  const options = () => ({ cwd, home, adapters: [] });
  const frame = async (term: ReturnType<typeof terminal>, text: string) => {
    await vi.waitFor(() => expect(term.frame()).toContain(text));
  };
  const open = (term: ReturnType<typeof terminal>) => buildProgram({ ...options(), appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
  const record = (intent: string, daysAgo = 0) => appendSession({ intent, startCommit,
    startedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    endedAt: new Date(Date.now() - daysAgo * 86_400_000 + 1000).toISOString() }, options());
  const menuHistory = (term: ReturnType<typeof terminal>) => term.input.write("m\u001b[B\u001b[B\r");
  beforeEach(async () => {
    vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-workspace-history-"));
    cwd = path.join(root, "repo"); home = path.join(root, "store"); await mkdir(cwd);
    await exec("git", ["init", "-q", cwd]); await writeFile(path.join(cwd, "a.txt"), "base");
    await exec("git", ["-C", cwd, "add", "a.txt"]);
    await exec("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", "base"]);
    startCommit = (await exec("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
  });
  afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  it("opens from the menu, expands entries, and remembers Home and history without writing", async () => {
    await record("first report"); await record("a long latest goal ".repeat(70)); const beforeStore = await snapshot(home);
    const term = terminal(); const signals = process.listenerCount("SIGINT"); const running = open(term);
    await frame(term, "OVERVIEW"); term.input.write("\u001b[B\u001b[6~\u001b[6~"); const beforeHome = term.frame();
    menuHistory(term); await frame(term, "all recorded history"); term.input.write("\u001b[B\r");
    expect(term.frame()).toContain("> first report"); expect(term.frame()).toContain("Enter to expand");
    expect(term.frame()).not.toContain("CHANGED FILES"); term.input.write("\r"); expect(term.frame()).toContain("CHANGED FILES");
    term.input.write("\r"); term.input.emit("keypress", "", { name: "escape" }); await frame(term, "OVERVIEW");
    expect(term.frame()).toBe(beforeHome); menuHistory(term); await frame(term, "all recorded history");
    expect(term.frame()).toContain("> first report"); expect(term.frame()).toContain("Enter to expand");
    expect(term.input.listenerCount("keypress")).toBe(1); expect(process.listenerCount("SIGINT")).toBe(signals + 1);
    term.input.write("q"); await frame(term, "OVERVIEW"); term.input.write("q"); await running;
    expect(await snapshot(home)).toEqual(beforeStore); expect(term.raw).toHaveBeenLastCalledWith(false);
    expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(signals);
  });

  it("Review last selects old finished work and clears a previously narrowed history", async () => {
    await record("first report", 40); await record("latest report", 30);
    const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    menuHistory(term); await frame(term, "all recorded history"); term.input.write("/first report\rq"); await frame(term, "OVERVIEW");
    term.input.write("\r"); await frame(term, "all recorded history");
    expect(term.frame()).toContain("> latest report"); expect(term.frame()).toContain("2 matching sessions");
    expect(term.frame()).toContain("CHANGED FILES"); term.input.write("q"); await frame(term, "OVERVIEW"); term.input.write("q"); await running;
  });

  it("lets an empty history return Home without creating a store", async () => {
    const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    menuHistory(term); await frame(term, "all recorded history"); expect(term.frame()).toContain("No sessions.");
    term.input.emit("keypress", "", { name: "escape" }); await frame(term, "OVERVIEW"); term.input.write("q"); await running;
    await expect(access(home)).rejects.toThrow();
  });

  it("clears a filter and closes help before Escape returns Home", async () => {
    await record("finished work"); const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    menuHistory(term); await frame(term, "all recorded history"); term.input.write("/missing\r");
    expect(term.frame()).toContain("No matches."); term.input.emit("keypress", "", { name: "escape" });
    expect(term.frame()).toContain("1 matching sessions"); expect(term.frame()).not.toContain("OVERVIEW");
    term.input.write("?"); expect(term.frame()).toContain("KEYBOARD"); term.input.emit("keypress", "", { name: "escape" });
    expect(term.frame()).not.toContain("KEYBOARD"); expect(term.frame()).toContain("all recorded history");
    term.input.emit("keypress", "", { name: "escape" }); await frame(term, "OVERVIEW"); term.input.write("q"); await running;
  });

  it.each(["ctrl-c", "eof", "SIGTERM", "SIGHUP"] as const)("exits from history on %s without reopening Home", async mode => {
    await record("finished work"); const term = terminal(); const code = process.exitCode;
    const signals = (["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const);
    const listeners = signals.map(listenersFor);
    try {
      const running = open(term); await frame(term, "OVERVIEW"); term.input.write("\r"); await frame(term, "all recorded history");
      if (mode === "ctrl-c") term.input.write("\u0003");
      else if (mode === "eof") term.input.end();
      else {
        const existing = listeners[signals.indexOf(mode)]!;
        const added = process.listeners(mode).filter(listener => !existing.includes(listener)); expect(added).toHaveLength(1);
        (added[0] as () => void)();
      }
      await running; expect(term.frame()).not.toContain("OVERVIEW"); expect(term.raw).toHaveBeenLastCalledWith(false);
      expect(term.frame()).toContain(screenControl.leave); expect(term.input.listenerCount("keypress")).toBe(0);
      expect(term.output.listenerCount("resize")).toBe(0); expect(signals.map(listenersFor)).toEqual(listeners);
      if (mode !== "eof") expect(process.exitCode).toBe(mode === "ctrl-c" ? 130 : mode === "SIGTERM" ? 143 : 129);
    } finally { process.exitCode = code; }
  });

  it("cannot repaint Home when an old history refresh finishes after Back", async () => {
    const term = terminal(); const data = { sessions: [], repo: "example", rates: new Map() };
    let resolveRefresh!: (value: typeof data) => void;
    const running = runUi(data, () => new Promise(resolve => { resolveRefresh = resolve; }), plainPalette, term.io, { returnToHome: true });
    term.input.write("rq"); expect((await running).exitWorkspace).toBe(false);
    const atHome = runAppUi({ repo: "example", branch: "main", home: {} }, plainPalette, term.io); const before = term.frame();
    expect(before).toContain("OVERVIEW"); resolveRefresh(data); await new Promise(resolve => setImmediate(resolve));
    expect(term.frame()).toBe(before); term.input.write("q"); await atHome;
  });

  it.each(["paint", "output"])("preserves the %s failure when terminal cleanup also fails", async mode => {
    const term = terminal(); const data = { sessions: [], repo: "example", rates: new Map() };
    const signals = (["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const); const listeners = signals.map(listenersFor);
    const original = new Error("original failure"); const cleanup = new Error("cleanup failure"); const write = term.output.write.bind(term.output);
    if (mode === "paint") vi.spyOn(term.output, "write").mockImplementationOnce(write)
      .mockImplementationOnce(() => { throw original; }).mockImplementationOnce(() => { throw cleanup; });
    const running = runUi(data, async () => data, plainPalette, term.io, { returnToHome: true });
    if (mode === "output") { vi.spyOn(term.output, "write").mockImplementationOnce(() => { throw cleanup; }); term.output.emit("error", original); }
    await expect(running).rejects.toBe(original); expect(term.raw).toHaveBeenLastCalledWith(false);
    expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0);
    expect(term.input.listenerCount("error")).toBe(0); expect(term.output.listenerCount("error")).toBe(0);
    expect(signals.map(listenersFor)).toEqual(listeners);
  });
});
