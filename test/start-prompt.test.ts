import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { startPassiveSession, startSession } from "../src/commands/start.js";
import { getOpenSession, readSessions } from "../src/store.js";
import { ansiPalette, plainPalette, type Palette } from "../src/render/palette.js";
import { cellWidth } from "../src/render/tui/text.js";

const exec = promisify(execFile);
let root: string; let cwd: string; let home: string; let printed: string[];
const streams: PassThrough[] = [];
const options = () => ({ cwd, home, adapters: [] });
async function git(args: string[]) {
  const { stdout } = await exec("git", ["-C", cwd, ...args]); return stdout.trim();
}
async function commit(name: string) {
  await writeFile(path.join(cwd, name), name); await git(["add", "--", name]);
  await git(["commit", "-qm", name]); return git(["rev-parse", "HEAD"]);
}
function terminal() {
  let text = ""; let raw = 0;
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: () => { raw += 1; } });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); }); streams.push(input, output);
  return { input, output, text: () => text, raw: () => raw };
}
const ready = (io: ReturnType<typeof terminal>) => vi.waitFor(() => expect(io.text()).toContain("  What are you working on?\n  › "));
const run = (io: ReturnType<typeof terminal>, args = ["start"], palette: Palette = plainPalette) =>
  buildProgram({ ...options(), startTerminal: io, palette }).parseAsync(args, { from: "user" });
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm-256color"); printed = [];
  vi.spyOn(console, "log").mockImplementation((...lines) => { printed.push(lines.join(" ")); });
  root = await mkdtemp(path.join(tmpdir(), "session-start-prompt-")); cwd = path.join(root, "repo"); home = path.join(root, "store");
  await mkdir(cwd); await git(["init", "-q"]); await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]); await git(["config", "commit.gpgsign", "false"]);
  await commit("base.txt");
});
afterEach(async () => {
  streams.splice(0).forEach((stream) => stream.destroy()); vi.restoreAllMocks(); vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it.each([["plain", plainPalette], ["ANSI", ansiPalette]] as const)("bare start prints %s saved confirmation", async (_name, palette) => {
  const io = terminal(); const running = run(io, ["start"], palette);
  try {
    await ready(io); io.input.write("Build the UI\nsrc/a file.ts\nnotes/a,b*[draft].md\n\n"); await running;
    const [session] = await readSessions(options());
    expect(session?.intent).toBe("Build the UI"); expect(session?.scope).toEqual(["src/a file.ts", "notes/a,b*[draft].md"]);
    const displayed = printed.map(stripVTControlCharacters);
    expect(displayed[0]).toBe(""); expect(displayed).toContain("  ◔ session  recording");
    expect(displayed).toContain(`  intent      ${session?.intent}`);
    expect(displayed).toContain(`  scope       ${session?.scope[0]}`);
    expect(displayed).toContain(`              ${session?.scope[1]}`);
    expect(displayed).toContain(`  id          ${session?.id.slice(0, 8)}`);
    expect(displayed).toContain(`  head        ${session?.startCommit.slice(0, 7)}`);
    if (palette === ansiPalette) expect(printed.join("\n")).toContain("\u001b[36m");
    expect(io.raw()).toBe(0); expect(io.text()).not.toContain("\u001b");
  } finally { io.input.end(); await running; }
});
it("skips scope with a blank answer on a dumb terminal", async () => {
  vi.stubEnv("TERM", "dumb"); const io = terminal(); const running = run(io);
  await ready(io); io.input.write("Work with no scope\n\n"); await running;
  expect((await readSessions(options()))[0]?.scope).toEqual([]);
  expect(io.text()).toContain("Which files? Enter to skip."); expect(io.raw()).toBe(0);
});
it("uses --scope without asking for paths", async () => {
  const io = terminal(); const running = run(io, ["start", "--scope", "given/a file.ts", "notes/a,b.md"]);
  await ready(io); io.input.write("Use provided scope\n"); await running;
  expect((await readSessions(options()))[0]?.scope).toEqual(["given/a file.ts", "notes/a,b.md"]);
  expect(io.text()).not.toContain("Which files?");
});
it.each(["", "\n", "Intent\n", "Intent\nsrc/\n"])("creates no store for unfinished input %j", async (input) => {
  const io = terminal(); const running = run(io); await ready(io);
  const outcome = input === "\n" ? expect(running).rejects.toThrow(/No intent given/) : running;
  io.input.end(input); await outcome;
  expect(existsSync(home)).toBe(false); expect(await readSessions(options())).toEqual([]);
});
it.each(["open", "nonrepo", "unborn"] as const)("refuses %s before printing prompts", async (condition) => {
  if (condition === "open") await startSession("already working", options());
  else { cwd = path.join(root, condition); await mkdir(cwd); if (condition === "unborn") await git(["init", "-q"]); }
  const before = await readSessions(options()); const io = terminal();
  const error = condition === "open" ? /already open/ : condition === "unborn" ? /No commits yet/ : /Not a git repository/;
  await expect(run(io)).rejects.toThrow(error);
  expect(io.text()).toBe(""); expect(io.raw()).toBe(0); expect(await readSessions(options())).toEqual(before);
  if (condition !== "open") expect(existsSync(home)).toBe(false);
});
it("keeps captured work open on cancellation and closes it only after accepting", async () => {
  const captured = await startPassiveSession(options()); const cancelled = terminal(); const first = run(cancelled);
  await ready(cancelled); cancelled.input.end("Draft only\n"); await first;
  expect(await getOpenSession(options())).toEqual(captured);
  const accepted = terminal(); const second = run(accepted); await ready(accepted);
  accepted.input.write("Declared next\n\n"); await second;
  const sessions = await readSessions(options()); expect(sessions).toHaveLength(2);
  expect(sessions[0]?.endedAt).not.toBeNull(); expect(sessions[1]?.intent).toBe("Declared next");
  expect(printed.join("\n")).toContain("closed   the hook's session");
});
it("sanitizes a captured changed-path notice while keeping its literal record", async () => {
  const literal = "notes\u001b[2J.txt";
  await startPassiveSession(options()); await writeFile(path.join(cwd, literal), "captured change");
  const io = terminal(); const running = run(io); await ready(io);
  io.input.write("Declare safely\n\n"); await running;
  expect((await readSessions(options()))[0]?.reality).toEqual([literal]);
  expect(printed.find((line) => line.includes("closed   the hook's session"))).toContain("notes.txt");
  expect(printed.join("\n")).not.toContain("\u001b");
});
it("revalidates an open session created while the prompt was waiting", async () => {
  const io = terminal(); const running = run(io); await ready(io);
  const open = await startSession("opened meanwhile", options());
  const rejected = expect(running).rejects.toThrow(/already open/);
  io.input.write("Attempted later\n\n"); await rejected;
  expect(await readSessions(options())).toEqual([open]);
});
it("takes HEAD and the dirty baseline at acceptance", async () => {
  const io = terminal(); const running = run(io); await ready(io);
  const head = await commit("later.txt"); await writeFile(path.join(cwd, "dirty.txt"), "pre-existing");
  io.input.write("Use current facts\n\n"); await running;
  const [session] = await readSessions(options());
  expect(session?.startCommit).toBe(head); expect(session?.baseline).toEqual(["dirty.txt"]);
});
it("wraps the saved declaration at the width captured before prompting", async () => {
  const intent = "Keep every word of this declaration visible. ".repeat(3).trim();
  const literal = `src/${"a".repeat(90)}.ts`;
  const io = terminal(); io.output.columns = 60; const running = run(io); await ready(io);
  io.output.columns = 80; io.input.write(`${intent}\n${literal}\n\n`); await running;
  const [session] = await readSessions(options());
  expect(session?.intent).toBe(intent); expect(session?.scope).toEqual([literal]);
  const lines = printed.map(stripVTControlCharacters);
  expect(lines.every((line) => cellWidth(line) <= 60)).toBe(true);
  const first = lines.findIndex((line) => line.startsWith("  intent      "));
  const scope = lines.findIndex((line) => line.startsWith("  scope       "));
  const id = lines.findIndex((line) => line.startsWith("  id          "));
  expect(lines.slice(first, scope).map((line) => line.slice(14)).join(" ")).toBe(intent);
  expect(lines.slice(scope, id).map((line, index) => line.slice(index === 0 ? 14 : 16)).join("")).toBe(literal);
});
