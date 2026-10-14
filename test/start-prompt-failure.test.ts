import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { readSessions } from "../src/store.js";
import { plainPalette } from "../src/render/palette.js";
import { createStartRepo } from "./fixtures/start-repo.js";

let fixture: Awaited<ReturnType<typeof createStartRepo>>;
const streams: PassThrough[] = [];
beforeEach(async () => { fixture = await createStartRepo(); });
afterEach(async () => {
  streams.splice(0).forEach(stream => stream.destroy()); vi.restoreAllMocks();
  await rm(fixture.root, { recursive: true, force: true });
});

it("stops writing after the introduction's output fails and creates no record", async () => {
  const failure = new Error("terminal output failed"); let writes = 0;
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new class extends PassThrough {
    override write(): boolean { writes += 1; this.emit("error", failure); return false; }
  }(), { isTTY: true, columns: 40 });
  streams.push(input, output);
  const print = vi.spyOn(console, "log").mockImplementation(() => {});
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const before = signals.map(signal => process.listenerCount(signal));
  input.write("Already queued\nsrc/\n\n");
  const program = buildProgram({ ...fixture, adapters: [], palette: plainPalette, startTerminal: { input, output } });
  await expect(program.parseAsync(["start"], { from: "user" })).rejects.toBe(failure);
  expect(writes).toBe(1); expect(print).not.toHaveBeenCalled();
  expect(signals.map(signal => process.listenerCount(signal))).toEqual(before);
  expect(output.listenerCount("error")).toBe(0);
  expect(existsSync(fixture.home)).toBe(false); expect(await readSessions(fixture)).toEqual([]);
});
