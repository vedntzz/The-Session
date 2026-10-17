import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { formatStarted } from "../src/commands/start.js";
import { readSessions, type Session } from "../src/store.js";
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

function comparableReceipt(lines: string[], session: Session): string[] {
  return lines.map(stripVTControlCharacters).map(line =>
    line.replaceAll(session.id.slice(0, 8), "<record>").replaceAll(session.startCommit.slice(0, 7), "<commit>"));
}
async function interactiveReceipt(io: ReturnType<typeof terminal>, palette: Palette) {
  io.input.isTTY = true;
  const running = buildProgram({ ...options(), startTerminal: io, palette }).parseAsync(["start"], { from: "user" });
  try {
    await vi.waitFor(() => expect(stripVTControlCharacters(io.prompts())).toContain("Enter to continue · Ctrl-C to cancel"));
    io.input.write("Shared declaration\nsrc/\ndocs/a file.md\n\n"); await running;
    const [session] = await readSessions(options()); return comparableReceipt(printed.slice(1), session!);
  } finally { io.input.end(); await running; }
}

it.each([[40, plainPalette], [80, ansiPalette]] as const)("matches the interactive panel for a quoted start at %i columns", async (width, palette) => {
  const io = terminal(width); const interactive = await interactiveReceipt(io, palette);
  const quoted = await createStartRepo(); const prompts = io.prompts(); printed = [];
  try {
    await buildProgram({ ...quoted, adapters: [], appTerminal: io, palette }).parseAsync(
      ["start", "Shared declaration", "--scope", "src/", "docs/a file.md"], { from: "user" });
    const [session] = await readSessions(quoted);
    expect(comparableReceipt(printed, session!)).toEqual(interactive);
    expect(io.prompts()).toBe(prompts);
  } finally { await rm(quoted.root, { recursive: true, force: true }); }
});
