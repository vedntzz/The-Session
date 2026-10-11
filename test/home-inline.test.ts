import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { startPassiveSession, startSession } from "../src/commands/start.js";
import { captureIntent, getOpenSession, zeroCost, type Session } from "../src/store.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { plainPalette } from "../src/render/palette.js";
import { formatHome } from "../src/render/terminal.js";
import { cellWidth } from "../src/render/tui/text.js";

const exec = promisify(execFile);
let root: string; let cwd: string; let home: string; let printed: string[];
const streams: PassThrough[] = [];
const options = () => ({ cwd, home, adapters: [] });
async function git(args: string[]) { await exec("git", ["-C", cwd, ...args]); }
function terminal(columns = 80, isTTY = true) {
  const raw = vi.fn(); let text = "";
  const input = Object.assign(new PassThrough(), { isTTY, isRaw: false, setRawMode: raw });
  const output = Object.assign(new PassThrough(), { isTTY, columns, rows: 24 });
  output.on("data", (chunk) => { text += String(chunk); }); streams.push(input, output);
  return { input, output, raw, text: () => text };
}
async function bare(io: ReturnType<typeof terminal>) {
  let done = false;
  const running = buildProgram({ ...options(), palette: plainPalette, appTerminal: io as unknown as UiTerminal }).parseAsync([], { from: "user" });
  const watched = running.finally(() => { done = true; });
  try { await vi.waitFor(() => expect(done).toBe(true), { timeout: 1000, interval: 10 }); await watched; }
  finally { if (!done) { io.input.end(); await watched; } }
}
async function snapshot() {
  const contents: Record<string, string> = {};
  for (const name of (await readdir(home, { recursive: true })).sort()) {
    const file = path.join(home, name);
    contents[name] = (await stat(file)).isFile() ? `file:${(await readFile(file)).toString("base64")}` : "directory";
  }
  return contents;
}
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm"); printed = [];
  vi.spyOn(console, "log").mockImplementation((line) => { printed.push(String(line)); });
  root = await mkdtemp(path.join(tmpdir(), "session-home-inline-")); cwd = path.join(root, "repo"); home = path.join(root, "store");
  await mkdir(cwd); await git(["init", "-q"]); await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]); await git(["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(cwd, "base.txt"), "base"); await git(["add", "base.txt"]); await git(["commit", "-qm", "base"]);
});
afterEach(async () => {
  streams.splice(0).forEach((stream) => stream.destroy()); vi.restoreAllMocks(); vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it.each(["xterm", "dumb", "pipe"])("returns inline without owning %s input or creating a store", async (mode) => {
  vi.stubEnv("TERM", mode); const io = terminal(80, mode !== "pipe"); io.input.write("buffered input\n");
  const length = io.input.readableLength; const flowing = io.input.readableFlowing;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => process.listenerCount(signal));
  const on = vi.spyOn(io.input, "on"); const resume = vi.spyOn(io.input, "resume"); const pause = vi.spyOn(io.input, "pause");
  await bare(io);
  expect(printed.join("\n")).toContain("No sessions recorded in this repo yet.");
  expect(printed.filter((line) => /^\s+(?:next\s+)?session /.test(line))).toHaveLength(2);
  expect(io.raw).not.toHaveBeenCalled(); expect(io.text()).toBe("");
  expect(on).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  expect(io.input.readableLength).toBe(length); expect(io.input.readableFlowing).toBe(flowing);
  expect(["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => process.listenerCount(signal))).toEqual(signals);
  expect(io.input.destroyed || io.output.destroyed || io.output.writableEnded).toBe(false);
  expect(existsSync(home)).toBe(false);
});

it.each(["declared", "captured"] as const)("prints safe %s intent without changing any stored bytes", async (source) => {
  const intent = `First \u001b[2Jline${source === "declared" ? "." : ""}\nSecond line.`;
  if (source === "declared") await startSession(intent, options());
  else { const session = await startPassiveSession(options()); await captureIntent(session!.id, intent, options()); }
  const open = await getOpenSession(options()); const before = await snapshot(); const io = terminal();
  await bare(io);
  const text = printed.join("\n"); expect(text).not.toContain("\u001b");
  expect(text).toContain(source === "declared" ? "First line. Second line." : "First line …");
  if (source === "captured") expect(text).not.toContain("Second line.");
  expect(printed.filter((line) => /^\s+(?:next\s+)?session /.test(line))).toHaveLength(2);
  expect(await getOpenSession(options())).toEqual(open); expect(await snapshot()).toEqual(before);
  expect(io.raw).not.toHaveBeenCalled(); expect(io.text()).toBe("");
});

it.each([[60, true], [80, true], [60, false]] as const)("uses %i-column TTY=%s geometry and preserves the full declaration", async (columns, tty) => {
  const intent = "Keep all declared words in the home output. ".repeat(5).trim();
  const literal = `src/${"a".repeat(90)}.ts`;
  await startSession(intent, { ...options(), scope: [literal] }); const io = terminal(columns, tty); await bare(io);
  const first = printed.findIndex((line) => line.startsWith("  intent      "));
  const scope = printed.findIndex((line) => line.startsWith("  scope       "));
  const id = printed.findIndex((line) => line.startsWith("  id          "));
  const prose = printed.slice(first, scope);
  expect(prose.map((line) => line.slice(14)).join(" ")).toBe(intent);
  expect(printed.slice(scope, id).map((line, index) => line.slice(index ? 16 : 14)).join("")).toBe(literal);
  expect((await getOpenSession(options()))?.scope).toEqual([literal]);
  if (tty) expect(printed.every((line) => cellWidth(line) <= columns)).toBe(true);
  else { expect(prose).toHaveLength(1); expect(cellWidth(prose[0]!)).toBeGreaterThan(columns); }
});

const rates = new Map([["priced", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }]]);
const closed = (turns: number): Session => ({
  id: "abcdef01", repo: "local:test", intent: "Completed work", scope: [], baseline: [], reality: [], drift: [],
  cost: { ...zeroCost(), model: "priced", turns }, outcome: "empty", startCommit: "1234567",
  startedAt: "2026-01-15T14:02:00Z", endedAt: "2026-01-15T14:39:00Z",
});
it("omits money for unmeasured known-model cost", () => {
  expect(formatHome({ last: closed(0) }, plainPalette, { rates }).join("\n")).not.toContain("$");
});
it("keeps a genuine measured zero cost visible", () => {
  expect(formatHome({ last: closed(1) }, plainPalette, { rates }).join("\n")).toContain("$0.00");
});
