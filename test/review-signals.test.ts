import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { Agreement } from "../src/agreement.js";
import { reviewAgreement } from "../src/commands/review.js";

/**
 * How the agreement screen ends when it is not answered: SIGTERM, SIGHUP, or
 * an output that can no longer be written to.
 *
 * `review.test.ts` covers Ctrl-C. The rest are the same promise — the screen
 * returns no terms, so nothing is started, and every listener it put on the
 * process comes off again — for the ways a terminal goes away without a key
 * being pressed.
 */

const initial: Agreement = { paths: ["src"], actions: ["create", "edit"], sensitivePaths: [], policy: "record" };
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Answers arrive only after a prompt, as in `review.test.ts`. */
function terminal(answers: Array<string | null>, onPrompt?: (prompt: string) => void) {
  const chunks: string[] = [];
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        const text = String(chunk);
        chunks.push(text);
        if (text.endsWith("> ") || text.endsWith(": ")) {
          setImmediate(() => {
            onPrompt?.(text);
            const answer = answers.shift();
            if (answer == null) input.end();
            else input.write(`${answer}\n`);
          });
        }
        callback();
      },
    }),
    { isTTY: true, columns: 80 },
  );
  return { input, output, text: () => chunks.join("") };
}

/**
 * The listener the screen added for a signal, called directly: `process.emit`
 * would also reach whatever the test runner listens with.
 */
function sender(signal: NodeJS.Signals): () => void {
  const before = process.listeners(signal);
  return () => {
    const fresh = process.listeners(signal).filter((listener) => !before.includes(listener));
    expect(fresh).toHaveLength(1);
    (fresh[0] as () => void)();
  };
}

const counts = (): number[] => SIGNALS.map((signal) => process.listenerCount(signal));

const savedExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe.each([
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const)("the agreement screen on %s", (signal, code) => {
  it(`returns no terms and exits ${code}`, async () => {
    const send = sender(signal);
    const io = terminal([null], send);

    expect(await reviewAgreement("fix parser", initial, undefined, io)).toBeUndefined();
    expect(process.exitCode).toBe(code);
  });

  it("returns no terms when it arrives halfway through an edit", async () => {
    const send = sender(signal);
    const io = terminal(["paths", '["elsewhere/"]', "accept"], (prompt) => {
      if (prompt.startsWith("Accepted paths")) send();
    });

    expect(await reviewAgreement("fix parser", initial, undefined, io)).toBeUndefined();
    expect(process.exitCode).toBe(code);
  });

  it("takes every process listener it added back off, and pauses input it found paused", async () => {
    const before = counts();
    const send = sender(signal);
    const io = terminal([null], send);

    await reviewAgreement("fix parser", initial, undefined, io);

    expect(counts()).toEqual(before);
    expect(io.output.listenerCount("error")).toBe(0);
    expect(io.input.readableFlowing).toBe(false);
  });
});

describe("the agreement screen when its output fails", () => {
  it("rejects with the output's own error rather than returning terms", async () => {
    const io = terminal(["accept"], () => {
      io.output.emit("error", new Error("output closed"));
    });

    await expect(reviewAgreement("fix parser", initial, undefined, io)).rejects.toThrow("output closed");
  });

  it("does not read an exit code into it: a broken pipe is not a signal", async () => {
    process.exitCode = undefined;
    const io = terminal([null], () => {
      io.output.emit("error", new Error("output closed"));
    });

    await reviewAgreement("fix parser", initial, undefined, io).catch(() => undefined);
    expect(process.exitCode).toBeUndefined();
  });

  it("takes every listener it added back off", async () => {
    const before = counts();
    const io = terminal(["accept"], () => {
      io.output.emit("error", new Error("output closed"));
    });

    await reviewAgreement("fix parser", initial, undefined, io).catch(() => undefined);

    expect(counts()).toEqual(before);
    expect(io.output.listenerCount("error")).toBe(0);
  });

  it("fails at the edit prompt too, keeping none of the edit", async () => {
    const io = terminal(["paths", '["elsewhere/"]', "accept"], (prompt) => {
      if (prompt.startsWith("Accepted paths")) io.output.emit("error", new Error("output closed"));
    });

    await expect(reviewAgreement("fix parser", initial, undefined, io)).rejects.toThrow("output closed");
  });
});
