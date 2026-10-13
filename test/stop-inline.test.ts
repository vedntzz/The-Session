import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import type { PromptTerminal } from "../src/commands/prompt-terminal.js";
import { startSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { verifyLog } from "../src/commands/verify.js";
import { sweepStampFile } from "../src/commands/sweep.js";
import type { Adapter } from "../src/capture/adapter.js";
import { readSessions, zeroCost } from "../src/store.js";
import { plainPalette } from "../src/render/palette.js";
import { cellWidth } from "../src/render/tui/text.js";
import * as observe from "../src/observe.js";

const exec = promisify(execFile);
let root: string; let cwd: string; let home: string; let printed: string[];
const streams: PassThrough[] = []; const options = () => ({ cwd, home, adapters: [] });
async function git(args: string[]) { await exec("git", ["-C", cwd, ...args]); }
async function run(columns = 80, tty = true, args = ["stop"], adapters: Adapter[] = []) {
  const input = Object.assign(new PassThrough(), { isTTY: tty, isRaw: false, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: tty, columns, rows: 24 }); streams.push(input, output);
  await buildProgram({ ...options(), adapters, palette: plainPalette, appTerminal: { input, output } as PromptTerminal }).parseAsync(args, { from: "user" });
  expect(input.setRawMode).not.toHaveBeenCalled(); return printed.map(stripVTControlCharacters);
}
beforeEach(async () => {
  printed = []; vi.spyOn(console, "log").mockImplementation((line) => { printed.push(String(line)); });
  root = await mkdtemp(path.join(tmpdir(), "session-stop-inline-")); cwd = path.join(root, "repo"); home = path.join(root, "store");
  await mkdir(cwd); await git(["init", "-q"]); await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]); await git(["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(cwd, "base.txt"), "base"); await git(["add", "base.txt"]); await git(["commit", "-qm", "base"]);
});
afterEach(async () => {
  streams.splice(0).forEach((stream) => stream.destroy()); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true });
});
it.each([false, true])("counts the actual diff with a baseline changed again=%s", async (touched) => {
  await writeFile(path.join(cwd, "base.txt"), "dirty before");
  const open = await startSession("Track changed files", { ...options(), scope: ["base.txt", "new file.ts"] });
  await writeFile(path.join(cwd, "new file.ts"), "new"); if (touched) await writeFile(path.join(cwd, "base.txt"), "changed again");
  const lines = await run(); const [saved] = await readSessions(options());
  expect(saved?.reality).toEqual(touched ? ["base.txt", "new file.ts"] : ["new file.ts"]);
  expect(saved?.id).toBe(open.id); expect(saved?.intent).toBe(open.intent); expect(saved?.scope).toEqual(open.scope);
  expect(saved?.endedAt).not.toBeNull(); expect(await readSessions(options())).toHaveLength(1);
  expect(lines).toContain(`  changed     ${touched ? "2 files" : "1 file"}`); expect(lines).toContain(`  id          ${open.id.slice(0, 8)}`);
  expect(lines).toContain("  cost        unknown"); expect(lines).toContain("  turns       unknown"); expect(lines).toContain("  tokens      unknown");
});
it.each([[60, true], [80, true], [60, false]] as const)("wraps safe confirmation at %i columns TTY=%s", async (columns, tty) => {
  const intent = "Keep every declared word in the completion. ".repeat(4).trim(); const literal = `資料/${"é界".repeat(30)}.ts`;
  await startSession(intent, { ...options(), scope: [literal] }); await mkdir(path.dirname(path.join(cwd, literal)));
  await writeFile(path.join(cwd, literal), "changed"); const lines = await run(columns, tty);
  const first = lines.findIndex((line) => line.startsWith("  intent      ")); const scope = lines.findIndex((line) => line.startsWith("  scope       "));
  const changed = lines.findIndex((line) => line.startsWith("  changed     ")); const outside = lines.findIndex((line) => line.startsWith("  outside     "));
  expect(lines.slice(first, scope).map((line) => line.slice(14)).join(" ")).toBe(intent);
  expect(lines.slice(changed + 1, outside).map((line, index) => line.slice(index ? 16 : 14)).join("")).toBe(literal);
  expect((await readSessions(options()))[0]?.reality).toEqual([literal]);
  if (tty) expect(lines.every((line) => cellWidth(line) <= columns)).toBe(true);
  else expect(lines[first]).toBe(`  intent      ${intent}`);
});
it("prints the saved completion before the daily outcome notice", async () => {
  await startSession("Land earlier work", { ...options(), scope: ["base.txt"] }); await writeFile(path.join(cwd, "base.txt"), "landed");
  await stopSession(options()); await git(["add", "base.txt"]); await git(["commit", "-qm", "landed"]);
  const open = await startSession("Finish current work", { ...options(), scope: ["base.txt"] }); const lines = await run();
  expect(lines).toContain("  changed     0 files"); expect(lines).toContain(`  id          ${open.id.slice(0, 8)}`);
  expect(lines.filter((line) => line === "  ◔ session  stopped")).toHaveLength(1);
  expect(lines.indexOf("  next        session week last --full")).toBeLessThan(lines.indexOf("  recorded 1 outcome"));
  expect(await readSessions(options())).toHaveLength(2);
});
it("sanitizes completion text while preserving literal signed intent and paths", async () => {
  const intent = "Work\u001b[2J safely"; const literal = "notes\u001b[2J.txt";
  await startSession(intent, { ...options(), scope: [literal] }); await writeFile(path.join(cwd, literal), "changed");
  const lines = await run(); const [saved] = await readSessions(options());
  expect(saved?.intent).toBe(intent); expect(saved?.reality).toEqual([literal]);
  expect(lines).toContain("  intent      Work safely"); expect(lines).toContain("              notes.txt");
  expect(printed.join("\n")).not.toContain("\u001b");
});
it.each([true, false])("records the actual diff with an accepted scope=%s", async (scoped) => {
  const scope = scoped ? ["base.txt"] : []; const open = await startSession("Change inside and outside", { ...options(), ...(scoped ? { scope } : {}) });
  await writeFile(path.join(cwd, "base.txt"), "inside"); await writeFile(path.join(cwd, "outside file.ts"), "outside");
  const lines = await run(); const [saved] = await readSessions(options());
  expect(saved?.intent).toBe(open.intent); expect(saved?.scope).toEqual(scope); expect(saved?.id).toBe(open.id);
  expect(saved?.reality).toEqual(["base.txt", "outside file.ts"]);
  expect(saved?.drift).toEqual(scoped ? ["outside file.ts"] : ["base.txt", "outside file.ts"]);
  expect(lines).toContain(`  scope       ${scoped ? "base.txt" : "none declared"}`); expect(lines).toContain("  changed     2 files");
  expect(lines).toContain(`  outside     ${scoped ? "1 file" : "unknown"}`);
  if (scoped) expect(lines).toContain("              ! outside file.ts");
  else { expect(lines).toContain("              no scope declared to compare against"); expect(lines.join("\n")).not.toContain("! "); }
  expect(await readSessions(options())).toHaveLength(1);
  expect((await verifyLog(options())).check).toMatchObject({ signaturesChecked: true, total: 2, verified: 2 });
});
it.each([true, false])("shows a freshly resolved outcome when work was committed=%s", async (committed) => {
  const open = await startSession("Finish visible work", { ...options(), scope: ["base.txt"] });
  await writeFile(await sweepStampFile(options()), new Date().toISOString());
  if (committed) { await writeFile(path.join(cwd, "base.txt"), "landed"); await git(["add", "base.txt"]); await git(["commit", "-qm", "landed"]); }
  const lines = await run(); const [saved] = await readSessions(options());
  expect(lines).toContain(`  outcome     ${committed ? "merged" : "empty"}`); expect(saved?.outcome).toBe("open");
  expect(saved?.id).toBe(open.id); expect(saved?.intent).toBe(open.intent); expect(saved?.scope).toEqual(open.scope);
  expect(saved?.observations ?? []).toEqual([]);
});
it("loads actual model rates and prints one combined measured cost", async () => {
  await startSession("Measure captured work", options()); await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "rates.json"), JSON.stringify({ models: { priced: { input: 2, cacheRead: 3, cacheCreation: 5, output: 7 } } }));
  const cost = { ...zeroCost(), model: "priced", turns: 2, apiCalls: 2, inputTokens: 100_000, cacheReadTokens: 200_000, cacheCreationTokens: 300_000, outputTokens: 400_000 };
  const lines = await run(80, true, ["stop"], [{ name: "stub", isAvailable: async () => true, capture: async () => cost }]);
  expect(lines).toContain("  turns       2"); expect(lines).toContain("  cost        $5.10");
  expect(lines.filter((line) => line.startsWith("  cost"))).toHaveLength(1); expect((await readSessions(options()))[0]?.cost).toMatchObject(cost);
});
it("confirms a completed stop and sweeps when outcome lookup fails", async () => {
  await startSession("Finish before lookup fails", options());
  vi.spyOn(observe, "withOutcomes").mockRejectedValueOnce(new Error("private outcome lookup failure"));
  const lines = await run(); const [saved] = await readSessions(options());
  expect(lines).toContain("  ◔ session  stopped"); expect(lines).toContain("  outcome     unknown");
  expect(saved?.endedAt).not.toBeNull(); expect(saved?.outcome).toBe("open");
  expect((await verifyLog(options())).check).toMatchObject({ signaturesChecked: true, total: 2, verified: 2 });
  await expect(readFile(await sweepStampFile(options()), "utf8")).resolves.toMatch(/^\d{4}-/u);
  expect(lines.join("\n")).not.toContain("private outcome lookup failure");
});
it("keeps hook output exact without resolving outcome evidence", async () => {
  await startSession("Keep hook behavior", { ...options(), scope: ["base.txt"] }); await writeFile(path.join(cwd, "base.txt"), "edited");
  await writeFile(await sweepStampFile(options()), new Date().toISOString());
  const resolve = vi.spyOn(observe, "withOutcomes"); const lines = await run(80, true, ["stop", "--if-open"]);
  expect(lines).toEqual(["  stopped  Keep hook behavior", "  changed  base.txt"]); expect(resolve).not.toHaveBeenCalled();
});
