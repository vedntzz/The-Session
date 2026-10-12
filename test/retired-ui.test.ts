import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { startSession } from "../src/commands/start.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { plainPalette } from "../src/render/palette.js";

const exec = promisify(execFile);
let root: string; let cwd: string; let home: string; let printed: string[];
const streams: PassThrough[] = []; const options = () => ({ cwd, home, adapters: [] });
async function git(args: string[]) { await exec("git", ["-C", cwd, ...args]); }
function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60, rows: 24 }); let text = "";
  output.on("data", (chunk) => { text += String(chunk); }); streams.push(input, output);
  return { input, output, text: () => text };
}
function dispatch(args: string[], io: ReturnType<typeof terminal>) {
  const program = buildProgram({ ...options(), palette: plainPalette, appTerminal: io as unknown as UiTerminal });
  const output = { writeOut: (text: string) => { printed.push(text); }, writeErr: (text: string) => { printed.push(text); } };
  [program, ...program.commands].forEach((command) => command.exitOverride().configureOutput(output));
  return program.parseAsync(args, { from: "user" });
}
async function snapshot() {
  if (!existsSync(home)) return undefined;
  const files: Record<string, string> = {};
  for (const name of (await readdir(home, { recursive: true })).sort()) {
    const file = path.join(home, name); files[name] = (await stat(file)).isFile() ? (await readFile(file)).toString("base64") : "directory";
  }
  return files;
}
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm"); printed = []; vi.spyOn(console, "log").mockImplementation((line) => { printed.push(String(line)); });
  root = await mkdtemp(path.join(tmpdir(), "session-retired-ui-")); cwd = path.join(root, "repo"); home = path.join(root, "store");
  await mkdir(cwd); await git(["init", "-q"]); await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]); await git(["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(cwd, "base.txt"), "base"); await git(["add", "base.txt"]); await git(["commit", "-qm", "base"]);
});
afterEach(async () => {
  streams.splice(0).forEach((stream) => stream.destroy()); vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
});

it("keeps fullscreen UI out of the public command tree", () => {
  expect(buildProgram().commands.map((command) => command.name())).not.toContain("ui");
});
it.each([["ui", false], ["UI", true], ["ui", true], ["UI", false]] as const)("redirects %s with an open session=%s without taking ownership", async (name, open) => {
  if (open) await startSession("Keep the declaration", { ...options(), scope: ["base.txt"] });
  const before = await snapshot(); const io = terminal(); io.input.write("buffered input\n");
  const length = io.input.readableLength; const flowing = io.input.readableFlowing;
  const counts = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => process.listenerCount(signal));
  const on = vi.spyOn(io.input, "on"); const resume = vi.spyOn(io.input, "resume"); const pause = vi.spyOn(io.input, "pause");
  await expect(dispatch([name, "legacy-id"], io)).rejects.toThrow(`No command ${name} — use session week, or session week <id> --full for full evidence.`);
  expect(await snapshot()).toEqual(before); expect(io.input.setRawMode).not.toHaveBeenCalled(); expect(io.text()).toBe("");
  expect(on).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  expect(io.input.readableLength).toBe(length); expect(io.input.readableFlowing).toBe(flowing);
  expect(["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => process.listenerCount(signal))).toEqual(counts);
  expect(io.input.destroyed || io.output.destroyed || io.output.writableEnded).toBe(false);
});
it.each([{ args: ["--help"] }, { args: ["help", "all"] }])("keeps the help surface %j free of fullscreen UI", async ({ args }) => {
  const io = terminal();
  if (args[0] === "--help") await expect(dispatch(args, io)).rejects.toMatchObject({ code: "commander.helpDisplayed" });
  else await dispatch(args, io);
  expect(printed.join("\n")).not.toMatch(/\bui\b/iu); expect(printed.join("\n")).toContain("week");
  expect(existsSync(home)).toBe(false); expect(io.input.setRawMode).not.toHaveBeenCalled(); expect(io.text()).toBe("");
});
it("refuses week --ui as an unknown flag without creating a store", async () => {
  const io = terminal(); await expect(dispatch(["week", "--ui"], io)).rejects.toMatchObject({ code: "commander.unknownOption" });
  expect(printed.join("\n")).toContain("unknown option '--ui'"); expect(existsSync(home)).toBe(false);
  expect(io.input.setRawMode).not.toHaveBeenCalled(); expect(io.text()).toBe("");
});
it("gives retired guidance outside a repository without creating a store", async () => {
  cwd = root; const io = terminal(); await expect(dispatch(["ui"], io)).rejects.toThrow("No command ui — use session week");
  expect(existsSync(home)).toBe(false); expect(io.input.setRawMode).not.toHaveBeenCalled(); expect(io.text()).toBe("");
});
