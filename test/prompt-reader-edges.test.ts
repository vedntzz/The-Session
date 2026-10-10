import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { createPromptReader } from "../src/commands/prompt-reader.js";

it("keeps delayed CRLF split across chunks as one line ending", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const reader = createPromptReader({ input, output });
  const answers = reader[Symbol.asyncIterator]();
  try {
    input.write("src/a file.ts\r");
    expect(await answers.next()).toEqual({ value: "src/a file.ts", done: false });
    // readline's default CRLF delay is 100 ms; the cooked reader must use Infinity.
    await new Promise((resolve) => setTimeout(resolve, 120));
    input.end("\ntest/\n");
    expect(await answers.next()).toEqual({ value: "test/", done: false });
    expect((await answers.next()).done).toBe(true);
  } finally {
    reader.close();
    input.destroy();
    output.destroy();
  }
});

it("settles a pending read when the caller closes the reader", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const reader = createPromptReader({ input, output });
  const answers = reader[Symbol.asyncIterator]();
  try {
    const pending = answers.next();
    reader.close();
    reader.close();
    expect((await pending).done).toBe(true);
    expect((await answers.next()).done).toBe(true);
    expect(input.destroyed).toBe(false);
    expect(output.destroyed).toBe(false);
    expect(output.writableEnded).toBe(false);
  } finally {
    reader.close();
    input.destroy();
    output.destroy();
  }
});
