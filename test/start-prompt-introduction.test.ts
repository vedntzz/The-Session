import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { readSessions } from "../src/store.js";
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
