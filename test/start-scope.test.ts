import type { Interface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { createPromptReader } from "../src/commands/prompt-reader.js";
import { promptIntent } from "../src/commands/start-intent.js";
import { promptScope } from "../src/commands/start-scope.js";

const PROMPT = "  Which files? Enter to skip.\n  One file or folder per line; an empty line finishes.\n  › ";
const readers: Interface[] = [];
const streams: PassThrough[] = [];

function terminal(output = new PassThrough()) {
  let rawModeCalls = 0;
  const input = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: () => { rawModeCalls += 1; },
  });
  Object.assign(output, { isTTY: true, columns: 80 });
  const reader = createPromptReader({ input, output });
  readers.push(reader);
  streams.push(input, output);
  const answers = reader[Symbol.asyncIterator]();
  let written = "";
  output.on("data", (chunk: Buffer) => { written += chunk.toString(); });
  return { input, output, reader, answers, written: () => written, rawModeCalls: () => rawModeCalls };
}

afterEach(() => {
  readers.splice(0).forEach((reader) => reader.close());
  streams.splice(0).forEach((stream) => stream.destroy());
});

it("prints the exact question and skips scope on a first blank line", async () => {
  const io = terminal();
  const scope = promptScope(io.answers, io.output);
  io.input.write("\n");
  expect(await scope).toEqual([]);
  expect(io.written()).toBe(PROMPT);
});

it("skips scope on a first whitespace-only line", async () => {
  const io = terminal();
  const scope = promptScope(io.answers, io.output);
  io.input.write(" \t  \n");
  expect(await scope).toEqual([]);
  expect(io.written()).toBe(PROMPT);
});

it("takes one literal trimmed path per line and finishes on whitespace", async () => {
  const io = terminal();
  const scope = promptScope(io.answers, io.output);
  io.input.write("  src/a file.ts  \nnotes/a,b.md\n資料/[draft]*.md\n \t\n");
  expect(await scope).toEqual(["src/a file.ts", "notes/a,b.md", "資料/[draft]*.md"]);
  expect(io.written()).toBe(`${PROMPT}${"  › ".repeat(3)}`);
  expect(io.rawModeCalls()).toBe(0);
});

it.each(["", "src/render/\n", "src/render"])("cancels at EOF after %j", async (input) => {
  const io = terminal();
  const scope = promptScope(io.answers, io.output);
  io.input.end(input);
  expect(await scope).toBeUndefined();
});

it("shares a pasted iterator with intent and leaves answers beyond the blank queued", async () => {
  const io = terminal();
  const intent = promptIntent(io.answers, io.output);
  io.input.write("Build the UI\nsrc/a file.ts\nnotes/a,b.md\n\nlater answer\n");
  expect(await intent).toBe("Build the UI");
  expect(await promptScope(io.answers, io.output)).toEqual(["src/a file.ts", "notes/a,b.md"]);
  expect(await io.answers.next()).toEqual({ value: "later answer", done: false });
});

it("leaves the reader and streams owned by the caller after skipping", async () => {
  const io = terminal();
  let closed = false;
  io.reader.on("close", () => { closed = true; });
  const scope = promptScope(io.answers, io.output);
  io.input.write("\n");
  expect(await scope).toEqual([]);
  expect(closed).toBe(false);
  expect(io.input.destroyed).toBe(false);
  expect(io.output.destroyed).toBe(false);
  expect(io.output.writableEnded).toBe(false);
});

it("rejects the original input error while waiting for more paths", async () => {
  const io = terminal();
  const failure = new Error("input failed");
  const scope = promptScope(io.answers, io.output);
  io.input.write("src/\n");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(io.written()).toBe(`${PROMPT}  › `);
  const rejected = expect(scope).rejects.toBe(failure);
  io.input.destroy(failure);
  await rejected;
});

it("rejects a failed continuation write without consuming remaining answers", async () => {
  const failure = new Error("output failed");
  let writes = 0;
  const output = new class extends PassThrough {
    override write(chunk: string | Uint8Array): boolean {
      if (++writes === 2) throw failure;
      return super.write(chunk);
    }
  }();
  const io = terminal(output);
  const scope = promptScope(io.answers, io.output);
  const rejected = expect(scope).rejects.toBe(failure);
  io.input.write("src/\n\nstill available\n");
  await rejected;
  expect(await io.answers.next()).toEqual({ value: "", done: false });
  expect(await io.answers.next()).toEqual({ value: "still available", done: false });
});
