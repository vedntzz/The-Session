import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { sectionCommand } from "../src/program/home.js";
import { plainPalette, screenControl } from "../src/render/palette.js";
import { UI_MENU } from "../src/render/tui/menu.js";

const view = { repo: "~/example", branch: "feature/ui", home: {} };
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw });
  Object.assign(output, { isTTY: true, columns: 100, rows: 32 });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, raw, text: () => text, io: { input, output } as unknown as UiTerminal };
}
let root: string;
beforeEach(async () => { vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-app-ui-")); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("Session app entry and terminal ownership", () => {
  it("opens Home from the bare command and hands back a command without creating files", async () => {
    const term = terminal();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const running = buildProgram({ cwd: root, home: path.join(root, "store"), palette: plainPalette, appTerminal: term.io }).parseAsync([], { from: "user" });
    await vi.waitFor(() => expect(term.text()).toContain("OVERVIEW")); term.input.write("\r"); await running;
    expect(term.raw.mock.calls).toEqual([[true], [false]]); expect(term.text()).toContain(screenControl.leave);
    expect(log.mock.calls.flat().join("\n")).toContain("Open Start session with: session start");
    expect(await readdir(root)).toEqual([]);
  });

  it("preserves Home selection when returning from the menu and restores all listeners", async () => {
    const term = terminal(); const signals = process.listenerCount("SIGINT");
    const running = runAppUi(view, plainPalette, term.io);
    term.input.write("\u001b[Bm"); expect(term.text()).toContain("SECTIONS");
    term.input.emit("keypress", "", { name: "escape" });
    expect(term.text().split(screenControl.paint).at(-1)).toContain("> Capture setup");
    term.input.write("\r"); expect(await running).toEqual({ label: "Capture setup", screen: "hooks" });
    expect(term.input.isPaused()).toBe(true); expect(term.input.listenerCount("keypress")).toBe(0);
    expect(term.output.listenerCount("resize")).toBe(0); expect(process.listenerCount("SIGINT")).toBe(signals);
  });

  it("keeps menu selection visible after a resize and returns its destination", async () => {
    const term = terminal(); const running = runAppUi(view, plainPalette, term.io);
    term.input.write("m\u001b[B\u001b[B\u001b[B");
    Object.assign(term.output, { columns: 60, rows: 20 }); term.output.emit("resize");
    expect(term.text().split(screenControl.paint).at(-1)).toContain("> Week report");
    term.input.write("\r"); expect(await running).toMatchObject({ screen: "week" });
    expect(term.raw).toHaveBeenLastCalledWith(false);
  });

  it("ignores pasted exit and selection keys and blocks selection below the minimum size", async () => {
    const term = terminal(); const running = runAppUi(view, plainPalette, term.io);
    term.input.write("\u001b[200~q\rm\r\u001b[201~"); expect(term.raw).toHaveBeenCalledTimes(1);
    Object.assign(term.output, { columns: 59 }); term.output.emit("resize"); term.input.write("\r");
    expect(term.raw).toHaveBeenCalledTimes(1); term.input.write("q"); await running;
    expect(term.text()).toContain(screenControl.pasteOff);
  });

  it.each(["input", "output", "entry", "paint"])("restores the terminal after %s failure", async failure => {
    const term = terminal();
    if (failure === "entry" || failure === "paint") {
      const write = vi.spyOn(term.output, "write");
      if (failure === "paint") write.mockImplementationOnce(() => true);
      write.mockImplementationOnce(() => { throw new Error("disconnected"); });
    }
    const running = runAppUi(view, plainPalette, term.io);
    if (failure === "input" || failure === "output") term[failure].emit("error", new Error("disconnected"));
    await expect(running).rejects.toThrow("disconnected");
    expect(term.raw).toHaveBeenLastCalledWith(false); expect(term.text()).toContain(screenControl.leave);
    expect(term.input.listenerCount("error")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0);
  });

  it("restores a previously raw, flowing terminal and handles Ctrl-C", async () => {
    const term = terminal(); Object.assign(term.input, { isRaw: true }); term.input.resume();
    const before = process.listenerCount("SIGINT"); const code = process.exitCode;
    try {
      const running = runAppUi(view, plainPalette, term.io); term.input.write("\u0003"); await running;
      expect(process.exitCode).toBe(130); expect(term.raw.mock.calls).toEqual([[true], [true]]);
      expect(term.input.isPaused()).toBe(false); expect(process.listenerCount("SIGINT")).toBe(before);
    } finally { process.exitCode = code; term.input.pause(); }
  });

  it("restores the terminal when input ends", async () => {
    const term = terminal(); const running = runAppUi(view, plainPalette, term.io);
    term.input.end(); expect(await running).toBeUndefined();
    expect(term.raw).toHaveBeenLastCalledWith(false); expect(term.text()).toContain(screenControl.leave);
  });

  it.each([["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const)("restores the terminal on %s", async (signal, expected) => {
    const term = terminal(); const code = process.exitCode; const listeners = process.listenerCount(signal);
    try {
      const running = runAppUi(view, plainPalette, term.io); process.emit(signal); await running;
      expect(process.exitCode).toBe(expected); expect(term.raw).toHaveBeenLastCalledWith(false);
      expect(term.text()).toContain(screenControl.pasteOff + screenControl.leave);
      expect(process.listenerCount(signal)).toBe(listeners);
    } finally { process.exitCode = code; }
  });

  it.each(["input", "output", "dumb"])("keeps %s terminals on the printable command path", async mode => {
    const term = terminal(); if (mode === "dumb") vi.stubEnv("TERM", "dumb"); else Object.assign(term[mode as "input" | "output"], { isTTY: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram({ cwd: root, home: path.join(root, "store"), palette: plainPalette, appTerminal: term.io }).parseAsync([], { from: "user" });
    expect(log.mock.calls.flat().join("\n")).toContain("No sessions recorded in this repo yet.");
    expect(term.raw).not.toHaveBeenCalled(); expect(term.text()).toBe("");
  });

  it("points every section at a registered command without running one", () => {
    const names = buildProgram().commands.map(command => command.name());
    UI_MENU.filter(item => item.screen !== "home").forEach(item => expect(names).toContain(sectionCommand(item).split(" ")[1]));
    expect(sectionCommand({ label: "Review", screen: "sessions", selectedSessionId: "12345678-example" })).toBe("session week '12345678' --full");
  });
});
