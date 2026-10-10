import { PassThrough } from "node:stream";
import type { Interface } from "node:readline";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPromptReader } from "../src/commands/prompt-reader.js";
import type { PromptTerminal } from "../src/commands/prompt-terminal.js";

const readers: Interface[] = [];
const streams: PassThrough[] = [];

function terminal(isTTY = false): PromptTerminal {
  const input = Object.assign(new PassThrough(), { isTTY });
  const output = Object.assign(new PassThrough(), { isTTY, columns: 80 });
  streams.push(input, output);
  return { input, output };
}

function readerFor(io: PromptTerminal): Interface {
  const reader = createPromptReader(io);
  readers.push(reader);
  return reader;
}

afterEach(() => {
  readers.splice(0).forEach((reader) => reader.close());
  streams.splice(0).forEach((stream) => stream.destroy());
});

describe("cooked prompt input", () => {
  it("answers a question through injected streams without screen controls", async () => {
    const io = terminal(true);
    const rawMode = vi.fn();
    Object.assign(io.input, { setRawMode: rawMode });
    let output = "";
    io.output.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const reader = readerFor(io);
    const answer = new Promise<string>((resolve) => reader.question("› ", resolve));
    (io.input as PassThrough).write("Make the terminal readable\n");
    expect(await answer).toBe("Make the terminal readable");
    expect(output).toBe("› ");
    expect(rawMode).not.toHaveBeenCalled();
  });

  it("keeps queued answers from one pasted chunk in order", async () => {
    const io = terminal();
    const answers = readerFor(io)[Symbol.asyncIterator]();
    (io.input as PassThrough).write("Build the UI\nsrc/render/\n");
    expect(await answers.next()).toEqual({ value: "Build the UI", done: false });
    expect(await answers.next()).toEqual({ value: "src/render/", done: false });
  });

  it("treats CRLF as one line ending and preserves spaces in paths", async () => {
    const io = terminal();
    const answers = readerFor(io)[Symbol.asyncIterator]();
    (io.input as PassThrough).write("src/a file.ts\r\ntest/\r\n");
    expect(await answers.next()).toEqual({ value: "src/a file.ts", done: false });
    expect(await answers.next()).toEqual({ value: "test/", done: false });
  });

  it("distinguishes a blank answer from end of input", async () => {
    const io = terminal();
    const answers = readerFor(io)[Symbol.asyncIterator]();
    (io.input as PassThrough).end("\n");
    expect(await answers.next()).toEqual({ value: "", done: false });
    expect((await answers.next()).done).toBe(true);
  });

  it("leaves supplied streams open when the caller closes the reader", () => {
    const io = terminal();
    readerFor(io).close();
    expect(io.input.destroyed).toBe(false);
    expect(io.output.destroyed).toBe(false);
    expect(io.output.writableEnded).toBe(false);
  });
});
