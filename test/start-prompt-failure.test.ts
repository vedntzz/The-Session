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

function failingTerminal(failure: Error, failedWrite: number) {
  let writes = 0;
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new class extends PassThrough {
    override write(chunk: string | Uint8Array): boolean {
      if (++writes === failedWrite) { this.emit("error", failure); return false; }
      return super.write(chunk);
    }
  }(), { isTTY: true, columns: 40 });
  streams.push(input, output);
  return { input, output, writes: () => writes };
}

it.each([["intent", 1], ["scope", 2], ["scope continuation", 3]] as const)("stops writing when the %s prompt fails and creates no record", async (_step, failedWrite) => {
  const failure = new Error("terminal output failed"); const io = failingTerminal(failure, failedWrite);
  const print = vi.spyOn(console, "log").mockImplementation(() => {});
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const before = signals.map(signal => process.listenerCount(signal));
  io.input.write("Already queued\nsrc/\n\n");
  const program = buildProgram({ ...fixture, adapters: [], palette: plainPalette, startTerminal: io });
  await expect(program.parseAsync(["start"], { from: "user" })).rejects.toBe(failure);
  expect(io.writes()).toBe(failedWrite); expect(print).not.toHaveBeenCalled();
  expect(signals.map(signal => process.listenerCount(signal))).toEqual(before);
  expect(io.output.listenerCount("error")).toBe(0);
  expect(existsSync(fixture.home)).toBe(false); expect(await readSessions(fixture)).toEqual([]);
});
