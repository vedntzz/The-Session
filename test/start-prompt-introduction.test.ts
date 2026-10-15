import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { getOpenSession, readSessions } from "../src/store.js";
import { startPassiveSession } from "../src/commands/start.js";
import { ansiPalette, plainPalette, type Palette } from "../src/render/palette.js";
import { cellWidth } from "../src/render/tui/text.js";
import { createStartRepo } from "./fixtures/start-repo.js";

let fixture: Awaited<ReturnType<typeof createStartRepo>>;
let printed: string[];
const streams: PassThrough[] = [];
const options = () => ({ cwd: fixture.cwd, home: fixture.home, adapters: [] });
function terminal() {
  let text = "";
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); }); streams.push(input, output);
  return { input, output, text: () => text };
}
const ready = (io: ReturnType<typeof terminal>) => vi.waitFor(() => expect(stripVTControlCharacters(io.text())).toContain("  Enter to continue · Ctrl-C to cancel\n\n  › "));
const run = (io: ReturnType<typeof terminal>, args = ["start"], palette: Palette = plainPalette) =>
  buildProgram({ ...options(), startTerminal: io, palette }).parseAsync(args, { from: "user" });
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm-256color"); printed = [];
  vi.spyOn(console, "log").mockImplementation((...lines) => { printed.push(lines.join(" ")); });
  fixture = await createStartRepo();
});
afterEach(async () => {
  streams.splice(0).forEach(stream => stream.destroy()); vi.restoreAllMocks(); vi.unstubAllEnvs();
  await rm(fixture.root, { recursive: true, force: true });
});

it.each([40, 60, 80])("prints one %i-column introduction before asking for intent", async (width) => {
  const io = terminal(); io.output.columns = width; const running = run(io, ["start"], ansiPalette);
  try {
    await ready(io);
    const lines = stripVTControlCharacters(io.text()).split("\n");
    expect(lines.slice(0, 4)).toEqual(["  ◔ session  start a session", "  " + "─".repeat(width - 2), "", "  Intent"]);
    expect(lines.every(line => cellWidth(line) <= width)).toBe(true);
    expect(io.text()).toContain(ansiPalette.intent("◔ session"));
    io.input.write("A literal declaration\nsrc/\n\n"); await running;
    expect(stripVTControlCharacters(io.text()).match(/start a session/gu)).toHaveLength(1);
    expect((await readSessions(options()))[0]?.intent).toBe("A literal declaration");
  } finally { io.input.end(); await running; }
});

it.each([["input pipe", false, true], ["output pipe", true, false]] as const)("refuses the %s without printing an introduction", async (_name, inputTTY, outputTTY) => {
  const io = terminal(); io.input.isTTY = inputTTY; io.output.isTTY = outputTTY;
  await expect(run(io)).rejects.toThrow(/No intent given/);
  expect(io.text()).toBe(""); expect(printed).toEqual([]); expect(existsSync(fixture.home)).toBe(false);
});

it.each([["plain", plainPalette], ["ANSI", ansiPalette]] as const)("separates the accepted intent from the scope prompt: %s", async (_name, palette) => {
  const io = terminal(); const running = run(io, ["start"], palette);
  try {
    await ready(io); io.input.write("Keep  café intent literal\n");
    await vi.waitFor(() => expect(io.text()).toContain("Which files?"));
    expect(stripVTControlCharacters(io.text())).toContain("  › \n  Scope (optional)\n  Which files?");
    expect(io.text()).toContain(palette.intent("Scope (optional)"));
    expect(io.text()).toContain(palette.meta("Empty line to finish or skip."));
    expect(await readSessions(options())).toEqual([]);
    io.input.write("src/a file.ts\n\n"); await running;
    const [session] = await readSessions(options());
    expect(session?.intent).toBe("Keep  café intent literal"); expect(session?.scope).toEqual(["src/a file.ts"]);
  } finally { io.input.end(); await running; }
});

const literalPaths = [
  "src/a  file.ts", "notes/a,b*[draft].md", "資料/cafe\u0301.ts",
  "-not-a-flag.txt", "notes/$(keep literal).md",
];
it.each([["LF", "\n", 40, plainPalette], ["CRLF", "\r\n", 80, ansiPalette]] as const)("preserves literal scope from a %s paste through recording", async (_name, ending, columns, palette) => {
  const intent = "Build  café UI — 改善";
  const io = terminal(); io.output.columns = columns; const running = run(io, ["start"], palette);
  try {
    await ready(io);
    io.input.write(["  " + intent + "  ", ...literalPaths.map(path => "  " + path + "  "), literalPaths[0], "", ""].join(ending));
    await running; const sessions = await readSessions(options());
    expect(sessions).toHaveLength(1); expect(sessions[0]?.intent).toBe(intent);
    expect(sessions[0]?.scope).toEqual(literalPaths);
    expect(printed.map(stripVTControlCharacters).every(line => cellWidth(line) <= columns)).toBe(true);
  } finally { io.input.end(); await running; }
});

it("records no declared scope when the first scope line contains only whitespace", async () => {
  const io = terminal(); const running = run(io);
  try {
    await ready(io); io.input.write("Skip optional scope\n \t \n"); await running;
    const sessions = await readSessions(options()); expect(sessions).toHaveLength(1);
    expect(sessions[0]?.intent).toBe("Skip optional scope"); expect(sessions[0]?.scope).toEqual([]);
    expect(printed.join("\n")).toContain("none declared");
  } finally { io.input.end(); await running; }
});

it.each(["src/a file.ts", "src/a file.ts\n資料/\n"])("keeps captured work unchanged when scope ends at EOF after %j", async (partial) => {
  const captured = await startPassiveSession(options()); const before = await readSessions(options());
  const io = terminal(); const running = run(io);
  try {
    await ready(io); io.input.end("Unfinished declaration\n" + partial); await running;
    expect(await readSessions(options())).toEqual(before); expect(await getOpenSession(options())).toEqual(captured);
    expect(printed.join("\n")).toContain("Cancelled. No session started.");
    expect(printed.join("\n")).not.toContain("RECORDING");
  } finally { io.input.end(); await running; }
});
