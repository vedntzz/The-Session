import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { plainPalette } from "../src/render/palette.js";
import { cellWidth } from "../src/render/tui/text.js";
import { readSessions } from "../src/store.js";
import { createStartRepo } from "./fixtures/start-repo.js";

let fixture: Awaited<ReturnType<typeof createStartRepo>>;
const streams: PassThrough[] = [];
function terminal(width = 80) {
  let text = "";
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: width });
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); });
  streams.push(input, output);
  return { input, output, text: () => text };
}
const run = (io: ReturnType<typeof terminal>, args = ["start"]) =>
  buildProgram({ ...fixture, adapters: [], palette: plainPalette, startTerminal: io }).parseAsync(args, { from: "user" });
const ready = (io: ReturnType<typeof terminal>) => vi.waitFor(() => expect(io.text()).toContain("Enter to continue"));
beforeEach(async () => {
  fixture = await createStartRepo();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  streams.splice(0).forEach(stream => stream.destroy()); vi.restoreAllMocks();
  await rm(fixture.root, { recursive: true, force: true });
});

it("guides intent and scope in tables before saving their literal values", async () => {
  const io = terminal(); const pending = run(io); await ready(io);
  expect(io.text()).toContain("Your declaration"); expect(io.text()).toContain("Enter below");
  expect(await readSessions(fixture)).toEqual([]);
  io.input.write("Build  café UI\n");
  await vi.waitFor(() => expect(io.text()).toContain("Which files?"));
  expect(io.text()).toContain("Build  café UI"); expect(io.text()).toContain("Enter paths below");
  expect(await readSessions(fixture)).toEqual([]);
  io.input.write("src/a file.ts\nnotes/[draft]*.md\n\n"); await pending;
  const [saved] = await readSessions(fixture);
  expect(saved?.intent).toBe("Build  café UI");
  expect(saved?.scope).toEqual(["src/a file.ts", "notes/[draft]*.md"]);
});

it("shows the provided scope while asking only for intent", async () => {
  const io = terminal(40); const pending = run(io, ["start", "--scope", "src/a file.ts"]);
  await ready(io); expect(io.text()).toContain("src/a file.ts");
  expect(io.text()).not.toContain("Optional; add next");
  io.input.write("Reuse supplied scope\n"); await pending;
  expect(io.text()).not.toContain("Which files?");
  expect((await readSessions(fixture))[0]?.scope).toEqual(["src/a file.ts"]);
});

it("adapts the scope table to a resized terminal and wraps the entered intent", async () => {
  const io = terminal(); const pending = run(io); await ready(io);
  const boundary = io.text().length; io.output.columns = 40;
  io.input.write("Keep all of the words in this declaration visible\n");
  await vi.waitFor(() => expect(io.text()).toContain("Which files?"));
  const scope = io.text().slice(boundary);
  expect(scope.split("\n").every(line => cellWidth(line) <= 40)).toBe(true);
  expect(scope).toContain("declaration visible");
  io.input.write("\n"); await pending;
  expect((await readSessions(fixture))[0]?.scope).toEqual([]);
});

it("creates no record when the draft form is cancelled before scope finishes", async () => {
  const io = terminal(); const pending = run(io); await ready(io);
  io.input.write("A draft only\n");
  await vi.waitFor(() => expect(io.text()).toContain("Which files?"));
  io.input.end("src/\n"); await pending;
  expect(await readSessions(fixture)).toEqual([]);
});
