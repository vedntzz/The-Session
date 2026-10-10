import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { withPromptReader } from "../src/commands/prompt-lifecycle.js";
import { promptIntent } from "../src/commands/start-intent.js";
import { promptScope } from "../src/commands/start-scope.js";
import type { PromptTerminal } from "../src/commands/prompt-terminal.js";

const streams: Writable[] = [];
function terminal(output: Writable = new PassThrough()) {
  const input = new PassThrough();
  input.pause();
  input.on("error", () => {});
  output.on("error", () => {});
  streams.push(input, output);
  const signals = Object.assign(new EventEmitter(), { exitCode: 7 as number | string | null | undefined });
  signals.on("SIGINT", () => {});
  return { input, output, signals };
}
async function collect(answers: AsyncIterator<string>, output: PromptTerminal["output"]) {
  const intent = await promptIntent(answers, output);
  if (intent === undefined) return undefined;
  const scope = await promptScope(answers, output);
  return scope === undefined ? undefined : { intent, scope };
}
function snapshot(io: ReturnType<typeof terminal>) {
  return [io.input, io.output, io.signals].map((bus) =>
    bus.eventNames().map((name) => [name, bus.listenerCount(name)]));
}
function cleanup(io: ReturnType<typeof terminal>, before: ReturnType<typeof snapshot>) {
  expect(snapshot(io)).toEqual(before);
  expect(io.input.destroyed).toBe(false);
  expect(io.output.destroyed).toBe(false);
  expect(io.output.writableEnded).toBe(false);
}
function delayedOutput() {
  let finish!: (error?: Error | null) => void;
  const output = new Writable({ autoDestroy: false,
    write(_chunk, _encoding, done) { finish = done; } });
  return { output, finish: (error?: Error) => finish(error) };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(() => streams.splice(0).forEach((stream) => stream.destroy()));

it.each([false, true])("collects pasted answers and restores prior flowing=%s", async (flowing) => {
  const io = terminal();
  if (flowing) io.input.resume();
  const before = snapshot(io);
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  io.input.write("Build the UI\nsrc/a file.ts\n\n");
  expect(await result).toEqual({ intent: "Build the UI", scope: ["src/a file.ts"] });
  expect(io.input.readableFlowing).toBe(flowing);
  expect(io.signals.exitCode).toBe(7);
  cleanup(io, before);
});
it.each(["", "Intent\n"])("cancels on EOF after %j", async (input) => {
  const io = terminal();
  const before = snapshot(io);
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  io.input.end(input);
  expect(await result).toBeUndefined();
  expect(snapshot(io)).toEqual(before);
  expect(io.output.writableEnded).toBe(false);
});
it("preserves blank-intent failure and cleans up", async () => {
  const io = terminal(); const before = snapshot(io);
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  io.input.write("\n");
  await expect(result).rejects.toThrow(/No intent given/);
  expect(io.signals.exitCode).toBe(7); cleanup(io, before);
});
it.each([["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const)("%s unblocks input", async (signal, code) => {
  const io = terminal(); const before = snapshot(io);
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  io.signals.emit(signal);
  expect(await result).toBeUndefined();
  expect(io.signals.exitCode).toBe(code); cleanup(io, before);
});
it("does not write another prompt from queued pasted answers after cancellation", async () => {
  const io = terminal(); let written = "";
  io.output.on("data", (chunk: Buffer) => { written += chunk.toString(); });
  const before = snapshot(io);
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  io.input.write("Already queued\nsrc/\n\n"); io.signals.emit("SIGINT");
  expect(await result).toBeUndefined();
  await turn();
  expect(written).toBe("  What are you working on?\n  › ");
  expect(io.signals.exitCode).toBe(130); cleanup(io, before);
});
it.each(["input", "output"] as const)("preserves an asynchronous %s error", async (stream) => {
  const io = terminal(); const before = snapshot(io); const failure = new Error("stream failed");
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  const rejected = expect(result).rejects.toBe(failure);
  io[stream].emit("error", failure);
  await rejected;
  expect(io.signals.exitCode).toBe(7); cleanup(io, before);
});
it("preserves a synchronous output failure", async () => {
  const failure = new Error("write failed");
  const output = new class extends PassThrough {
    override write(): boolean { throw failure; }
  }();
  const io = terminal(output); const before = snapshot(io);
  await expect(withPromptReader(io, (answers) => collect(answers, output), io.signals)).rejects.toBe(failure);
  cleanup(io, before);
});
it.each(["Complete\n\n", "\n"])("drains pending output failure after collection input %j", async (input) => {
  const blocked = delayedOutput(); const io = terminal(blocked.output); const before = snapshot(io);
  const failure = new Error("delayed write failed");
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  const rejected = expect(result).rejects.toBe(failure);
  io.input.write(input); await turn(); blocked.finish(failure);
  await rejected; cleanup(io, before);
});
it("cancels promptly while successful collection waits for blocked output", async () => {
  const blocked = delayedOutput(); const io = terminal(blocked.output); const before = snapshot(io);
  const result = withPromptReader(io, (answers) => collect(answers, io.output), io.signals);
  io.input.write("Complete\n\n"); await turn(); io.signals.emit("SIGINT");
  expect(await result).toBeUndefined();
  expect(io.signals.exitCode).toBe(130); cleanup(io, before);
});
