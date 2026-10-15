import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { formatStarted } from "../src/commands/start.js";
import { readSessions } from "../src/store.js";
import { ansiPalette, plainPalette, type Palette } from "../src/render/palette.js";
import { cellWidth } from "../src/render/tui/text.js";
import { createStartRepo } from "./fixtures/start-repo.js";

let fixture: Awaited<ReturnType<typeof createStartRepo>>; let printed: string[];
const streams: PassThrough[] = [];
function terminal(columns: number | undefined, isTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY: false });
  const output = Object.assign(new PassThrough(), { isTTY, columns });
  streams.push(input, output); let prompts = "";
  output.on("data", (chunk: Buffer) => { prompts += chunk.toString(); });
  return { input, output, prompts: () => prompts };
}
const options = () => ({ ...fixture, adapters: [] });
const run = (io: ReturnType<typeof terminal>, args: string[], palette: Palette = plainPalette) =>
  buildProgram({ ...options(), appTerminal: io, palette }).parseAsync(args, { from: "user" });
beforeEach(async () => {
  printed = []; vi.spyOn(console, "log").mockImplementation((...lines) => { printed.push(lines.join(" ")); });
  fixture = await createStartRepo();
});
afterEach(async () => {
  streams.splice(0).forEach(stream => stream.destroy()); vi.restoreAllMocks();
  await rm(fixture.root, { recursive: true, force: true });
});

it.each([40, 60, 80])("shows a saved panel for quoted start at %i columns without reading stdin", async columns => {
  const io = terminal(columns); const intent = "Build  café UI — 改善";
  const scope = ["src/a  file.ts", "資料/cafe\u0301.ts"];
  await run(io, ["start", intent, "--scope", ...scope], ansiPalette);
  const sessions = await readSessions(options()); expect(sessions).toHaveLength(1);
  expect(sessions[0]?.intent).toBe(intent); expect(sessions[0]?.scope).toEqual(scope);
  const lines = printed.map(stripVTControlCharacters);
  expect(lines[0]).toMatch(/^  ╭─+╮$/u); expect(cellWidth(lines[0]!)).toBe(columns);
  expect(lines[1]).toMatch(/^  │ ◔ session +RECORDING │$/u);
  expect(lines.every(line => cellWidth(line) <= columns)).toBe(true);
  expect(lines.some(line => line.includes(sessions[0]!.id.slice(0, 8)))).toBe(true);
  expect(printed.join("\n")).toContain("\u001b[");
  expect(io.prompts()).toBe(""); expect(io.input.readableFlowing).not.toBe(true);
});

it("shows an unframed confirmation when a terminal cannot report its width", async () => {
  const io = terminal(Number.NaN); await run(io, ["start", "Known declaration"]);
  expect(printed[0]).toBe("  ◔ session  RECORDING");
  expect(printed).toContain("  intent      Known declaration");
  expect(printed).toContain("  scope       none declared");
  expect(io.prompts()).toBe("");
});

it("keeps the legacy confirmation in a pipe even with ANSI requested", async () => {
  const io = terminal(40, false); await run(io, ["start", "Piped declaration", "--scope", "src/"], ansiPalette);
  const [session] = await readSessions(options()); expect(printed).toEqual(formatStarted(session!));
  expect(printed.join("\n")).not.toContain("\u001b"); expect(io.prompts()).toBe("");
});

it("keeps a passive start silent in a terminal", async () => {
  const io = terminal(40); await run(io, ["start", "--passive"]);
  const [session] = await readSessions(options()); expect(session?.intentSource).toBe("captured");
  expect(printed).toEqual([]); expect(io.prompts()).toBe("");
});
