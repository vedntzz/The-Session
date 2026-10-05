import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPassiveSession, startSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { buildProgram } from "../src/program.js";
import { plainPalette, screenControl } from "../src/render/palette.js";
import { getOpenSession, resolveStoreFile, readSessions } from "../src/store.js";
import type { UiTerminal } from "../src/commands/ui.js";

const exec = promisify(execFile);
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw });
  Object.assign(output, { isTTY: true, columns: 100, rows: 32 });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, raw, io: { input, output } as unknown as UiTerminal,
    frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}

describe("Start inside the Session workspace", () => {
  let root: string; let cwd: string; let home: string;
  const options = () => ({ cwd, home, adapters: [] });
  const frame = async (term: ReturnType<typeof terminal>, text: string) => {
    await vi.waitFor(() => expect(term.frame()).toContain(text));
  };
  const open = (term: ReturnType<typeof terminal>) => buildProgram({ ...options(), appTerminal: term.io, palette: plainPalette }).parseAsync([], { from: "user" });
  beforeEach(async () => {
    vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-workspace-start-"));
    cwd = path.join(root, "repo"); home = path.join(root, "store"); await mkdir(cwd);
    await exec("git", ["init", "-q", cwd]); await writeFile(path.join(cwd, "a.txt"), "base");
    await exec("git", ["-C", cwd, "add", "a.txt"]);
    await exec("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", "base"]);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it("returns to Home after repeated draft cancellation without saving or leaking listeners", async () => {
    const term = terminal(); const signals = process.listenerCount("SIGINT"); const running = open(term);
    await frame(term, "OVERVIEW");
    for (let i = 0; i < 3; i++) {
      term.input.write("\r"); await frame(term, "What are you building?");
      term.input.write("an unfinished goal"); term.input.emit("keypress", "", { name: "escape" });
      await frame(term, "OVERVIEW"); expect(term.frame()).not.toContain("an unfinished goal");
      expect(term.input.listenerCount("keypress")).toBe(1); expect(process.listenerCount("SIGINT")).toBe(signals + 1);
    }
    term.input.write("q"); await running; await expect(access(home)).rejects.toThrow();
    expect(term.raw).toHaveBeenLastCalledWith(false); expect(process.listenerCount("SIGINT")).toBe(signals);
    expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0);
  });

  it("opens Start from the menu, accepts once, and returns Home with the new session open", async () => {
    const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    term.input.write("m\u001b[B\r"); await frame(term, "What are you building?");
    await writeFile(path.join(cwd, "before.txt"), "pre-existing");
    term.input.write("add a welcome page\tsrc/a file.ts\u0013\u0013"); await frame(term, "OVERVIEW");
    expect(term.frame()).toContain("Session is recording."); expect(term.frame()).toContain("> Resume session");
    const [session] = await readSessions(options()); expect(session?.intent).toBe("add a welcome page");
    expect(session?.scope).toEqual(["src/a file.ts"]); expect(session?.baseline).toEqual(["before.txt"]);
    term.input.write("q"); await running; expect((await getOpenSession(options()))?.id).toBe(session?.id);
    expect(await readSessions(options())).toHaveLength(1);
  });

  it.each(["declared", "captured"])("returns from %s work without modifying its record", async source => {
    const session = source === "captured" ? await startPassiveSession(options()) : await startSession("keep this plan", options());
    const file = await resolveStoreFile(options()); const before = await readFile(file, "utf8");
    const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    term.input.write("\r"); await frame(term, source === "captured" ? "What are you building?" : "SESSION OPEN");
    expect(term.frame()).toContain(source === "captured" ? "Starting will close" : "Return to Home");
    term.input.emit("keypress", "", { name: "escape" }); await frame(term, "OVERVIEW"); term.input.write("q"); await running;
    expect((await getOpenSession(options()))?.id).toBe(session?.id); expect(await readFile(file, "utf8")).toBe(before);
  });

  it("restores Home selection and scroll when a new draft is cancelled", async () => {
    await startSession("a long goal ".repeat(80), options()); await stopSession(options());
    const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    term.input.write("\u001b[B\u001b[6~\u001b[6~"); const before = term.frame();
    expect(before).toContain("> Start session"); term.input.write("\r"); await frame(term, "What are you building?");
    term.input.emit("keypress", "", { name: "escape" }); await frame(term, "OVERVIEW");
    expect(term.frame()).toBe(before); term.input.write("q"); await running;
  });

  it("keeps the draft after a refused start and accepts it after the open session is closed", async () => {
    const term = terminal(); const running = open(term); await frame(term, "OVERVIEW");
    term.input.write("\r"); await frame(term, "What are you building?");
    const other = await startSession("concurrent work", options()); term.input.write("retry this goal\u0013");
    await frame(term, "A session is already open"); expect(term.frame()).toContain("retry this goal");
    expect((await getOpenSession(options()))?.id).toBe(other.id); await stopSession(options());
    term.input.write("\u0013"); await frame(term, "OVERVIEW"); term.input.write("q"); await running;
    expect((await getOpenSession(options()))?.intent).toBe("retry this goal"); expect(await readSessions(options())).toHaveLength(2);
  });

  it.each(["ctrl-c", "eof"])("exits the workspace on %s in Start without returning to Home or saving", async mode => {
    const term = terminal(); const code = process.exitCode;
    try {
      const running = open(term); await frame(term, "OVERVIEW"); term.input.write("\r"); await frame(term, "What are you building?");
      if (mode === "eof") term.input.end(); else term.input.write("\u0003"); await running;
      expect(term.frame()).not.toContain("OVERVIEW"); await expect(access(home)).rejects.toThrow();
      expect(term.raw).toHaveBeenLastCalledWith(false); expect(term.input.listenerCount("keypress")).toBe(0);
      if (mode === "ctrl-c") expect(process.exitCode).toBe(130);
    } finally { process.exitCode = code; }
  });

  it("finishes an accepted save before exiting on Ctrl-C, keeping the session open", async () => {
    const term = terminal(); const code = process.exitCode;
    try {
      const running = open(term); await frame(term, "OVERVIEW"); term.input.write("\r"); await frame(term, "What are you building?");
      term.input.write("keep accepted work\u0013\u0003"); await running;
      expect(process.exitCode).toBe(130); expect((await getOpenSession(options()))?.intent).toBe("keep accepted work");
      expect(await readSessions(options())).toHaveLength(1); expect(term.frame()).not.toContain("OVERVIEW");
      expect(term.raw).toHaveBeenLastCalledWith(false);
    } finally { process.exitCode = code; }
  });
});
