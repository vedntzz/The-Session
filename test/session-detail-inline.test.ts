import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import type { PromptTerminal } from "../src/commands/prompt-terminal.js";
import { startSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { verifyLog } from "../src/commands/verify.js";
import { readSessions, zeroCost, type Session } from "../src/store.js";
import { plainPalette } from "../src/render/palette.js";
import { cellWidth } from "../src/render/tui/text.js";
import { tableValues } from "./fixtures/table.js";

const exec = promisify(execFile); const streams: PassThrough[] = [];
let root: string; let cwd: string; let store: string; let saved: Session; let running: Session; let printed: string[];
const options = () => ({ cwd, home: store, adapters: [] });
async function run(args: string[], columns = 80, tty = true): Promise<string[]> {
  printed = [];
  const input = Object.assign(new PassThrough(), { isTTY: tty, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: tty, columns }); streams.push(input, output);
  await buildProgram({ ...options(), palette: plainPalette, appTerminal: { input, output } as PromptTerminal }).parseAsync(args, { from: "user" });
  expect(input.setRawMode).not.toHaveBeenCalled(); return printed;
}
beforeEach(async () => {
  printed = []; vi.spyOn(console, "log").mockImplementation(line => { printed.push(String(line)); });
  root = await mkdtemp(path.join(tmpdir(), "session-detail-inline-")); cwd = path.join(root, "repo"); store = path.join(root, "store");
  await mkdir(cwd); await mkdir(path.join(cwd, "src")); await exec("git", ["init", "-q", cwd]);
  await writeFile(path.join(cwd, "src/base.ts"), "before"); await exec("git", ["-C", cwd, "add", "."]);
  await exec("git", ["-C", cwd, "-c", "commit.gpgsign=false", "commit", "-qm", "base"]);
  await startSession("Keep full evidence visible", { ...options(), scope: ["src/"] });
  await writeFile(path.join(cwd, "src/base.ts"), "after"); await writeFile(path.join(cwd, "outside.txt"), "outside");
  const cost = { ...zeroCost(), model: "priced", turns: 2, apiCalls: 2, inputTokens: 100_000, cacheReadTokens: 200_000, cacheCreationTokens: 300_000, outputTokens: 400_000 };
  saved = await stopSession({ ...options(), adapters: [{ name: "stub", isAvailable: async () => true, capture: async () => cost }] });
  await writeFile(path.join(store, "rates.json"), JSON.stringify({ models: { priced: { input: 2, cacheRead: 3, cacheCreation: 5, output: 7 } } }));
  running = await startSession("Still recording", { ...options(), scope: ["src/"] });
});
afterEach(async () => {
  streams.splice(0).forEach(stream => stream.destroy()); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true });
});

it.each([40, 60, 80, 120])("uses the destination terminal for full detail at %i columns", async columns => {
  const lines = await run(["week", "last", "--full"], columns);
  expect(tableValues(lines, "intent").join(" ")).toBe(saved.intent);
  expect(tableValues(lines, "id")).toEqual([saved.id.slice(0, 8)]); expect(tableValues(lines, "outcome")).toEqual(["open"]);
  expect(tableValues(lines, "inside")).toEqual(["1 file", "src/base.ts"]);
  expect(tableValues(lines, "outside")).toEqual(["1 file", "! outside.txt"]);
  expect(tableValues(lines, "cost")).toEqual(["$5.10"]);
  expect(new Set(lines.filter(line => /^  [│╭╰├]/u.test(line)).map(cellWidth))).toEqual(new Set([Math.min(columns, 80)]));
  expect(lines.every(line => cellWidth(line) <= columns)).toBe(true);
});

it("makes --tokens select full detail and preserves the four counters", async () => {
  const lines = await run(["week", "last", "--tokens"], 40);
  expect(tableValues(lines, "tokens").join(" ")).toBe("100,000 in · 200,000 cache read · 300,000 cache write · 400,000 out");
  expect(tableValues(lines, "cost")[0]).toBe("$5.10"); expect(lines.every(line => cellWidth(line) <= 40)).toBe(true);
  expect((await verifyLog(options())).check).toMatchObject({ signaturesChecked: true, total: 3, verified: 3 });
});

it("selects the same closed session by ID prefix and last while another is running", async () => {
  const before = await readSessions(options()); const last = await run(["week", "last", "--full"]);
  expect(await run(["week", saved.id.slice(0, 8), "--full"])).toEqual(last);
  const active = await run(["week", running.id, "--full"]); expect(tableValues(active, "time").join(" ")).toContain("still running");
  expect(await readSessions(options())).toEqual(before);
});

it("retains plain output for a pipe and the brief layout without full flags", async () => {
  const piped = await run(["week", "last", "--full"], 40, false);
  expect(piped.some(line => /[│╭╰├]/u.test(line))).toBe(false); expect(piped).toContain(`  id          ${saved.id.slice(0, 8)}`);
  const brief = await run(["week", "last"], 40); expect(brief.some(line => /[│╭╰├]/u.test(line))).toBe(false);
});
