import type { Interface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { promptIntent } from "../src/commands/start-intent.js";
import { createPromptReader } from "../src/commands/prompt-reader.js";

const readers: Interface[] = [];
const streams: PassThrough[] = [];

function terminal(output = new PassThrough()) {
  const input = new PassThrough();
  const reader = createPromptReader({ input, output });
  readers.push(reader);
  streams.push(input, output);
  const answers = reader[Symbol.asyncIterator]();
  let written = "";
  output.on("data", (chunk: Buffer) => { written += chunk.toString(); });
  return { input, output, reader, answers, written: () => written };
}

afterEach(() => {
  readers.splice(0).forEach((reader) => reader.close());
  streams.splice(0).forEach((stream) => stream.destroy());
});

describe("promptIntent", () => {
  it("prints the exact question and returns a valid intent", async () => {
    const io = terminal();
    const answer = promptIntent(io.answers, io.output);
    io.input.write("Make the terminal readable\n");
    expect(await answer).toBe("Make the terminal readable");
    expect(io.written()).toBe("  What are you working on?\n  › ");
  });

  it("trims only the edges and keeps internal whitespace, punctuation and Unicode", async () => {
    const io = terminal();
    const answer = promptIntent(io.answers, io.output);
    io.input.write(" \tAdd  café:\t改善 api?!  \n");
    expect(await answer).toBe("Add  café:\t改善 api?!");
  });

  it.each(["", " \t  "])("rejects a blank intent %j", async (line) => {
    const io = terminal();
    const answer = promptIntent(io.answers, io.output);
    io.input.write(`${line}\n`);
    await expect(answer).rejects.toThrow(/No intent given/);
  });

  it("returns undefined when the input ends before an answer", async () => {
    const io = terminal();
    const answer = promptIntent(io.answers, io.output);
    io.input.end();
    expect(await answer).toBeUndefined();
  });

  it("leaves a pasted scope answer queued after reading the intent", async () => {
    const io = terminal();
    const answer = promptIntent(io.answers, io.output);
    io.input.write("Build the UI\nsrc/render/\n");
    expect(await answer).toBe("Build the UI");
    expect(await io.answers.next()).toEqual({ value: "src/render/", done: false });
  });

  it("leaves the reader and supplied streams owned by the caller", async () => {
    const io = terminal();
    let closed = false;
    io.reader.on("close", () => { closed = true; });
    const answer = promptIntent(io.answers, io.output);
    io.input.write("Continue working\n");
    expect(await answer).toBe("Continue working");
    expect(closed).toBe(false);
    expect(io.input.destroyed).toBe(false);
    expect(io.output.destroyed).toBe(false);
    expect(io.output.writableEnded).toBe(false);
  });

  it("rejects when input fails while waiting for an answer", async () => {
    const io = terminal();
    const failure = new Error("input failed");
    const answer = promptIntent(io.answers, io.output);
    const rejected = expect(answer).rejects.toBe(failure);
    io.input.destroy(failure);
    await rejected;
  });

  it("rejects a synchronous output failure without consuming an answer", async () => {
    const failure = new Error("output failed");
    const output = new class extends PassThrough {
      override write(): boolean { throw failure; }
    }();
    const io = terminal(output);
    await expect(promptIntent(io.answers, io.output)).rejects.toBe(failure);
    io.input.write("still available\n");
    expect(await io.answers.next()).toEqual({ value: "still available", done: false });
  });
});
