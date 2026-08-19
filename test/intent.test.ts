import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureFromPrompt,
  intentFromPrompt,
  MAX_INTENT,
  promptFromHook,
  readHookPayload,
} from "../src/commands/intent.js";
import {
  appendSession,
  readSessions,
  type NewSession,
  type StoreOptions,
} from "../src/store.js";

const T = {
  start: "2026-08-15T09:00:00.000Z",
  end: "2026-08-15T11:30:00.000Z",
};
const HEAD = "cdd3b4f0000000000000000000000000000000ab";

let root: string;
let options: StoreOptions;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-intent-"));
  const cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  options = { home: path.join(root, "store"), cwd };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A session as the hook opens one: no intent yet, nothing declared. */
function opened(): NewSession {
  return { startedAt: T.start, intent: null, intentSource: "captured", startCommit: HEAD, scope: [] };
}

/** A session as `session start` opens one. */
function declared(intent: string): NewSession {
  return { startedAt: T.start, intent, intentSource: "declared", startCommit: HEAD };
}

describe("intentFromPrompt", () => {
  it("keeps the developer's words as they were typed", () => {
    expect(intentFromPrompt("fix the login redirect loop")).toBe("fix the login redirect loop");
  });

  it("flattens a prompt written over several lines", () => {
    // A record is a line, and an intent with newlines in it would break every
    // view that prints one.
    expect(intentFromPrompt("fix the redirect\n\nit loops on logout")).toBe(
      "fix the redirect it loops on logout",
    );
  });

  it("trims the edges", () => {
    expect(intentFromPrompt("  add a retry  ")).toBe("add a retry");
  });

  it("is nothing at all for a prompt with nothing in it", () => {
    expect(intentFromPrompt("")).toBeUndefined();
    expect(intentFromPrompt("   \n\t ")).toBeUndefined();
  });

  it("cuts a prompt longer than the record keeps, and marks the cut", () => {
    const long = "x".repeat(MAX_INTENT * 2);

    const intent = intentFromPrompt(long) as string;

    expect([...intent]).toHaveLength(MAX_INTENT);
    expect(intent.endsWith("…")).toBe(true);
  });

  it("leaves a prompt exactly at the limit alone", () => {
    const exact = "x".repeat(MAX_INTENT);

    expect(intentFromPrompt(exact)).toBe(exact);
  });

  it("counts what a reader sees, not UTF-16 units", () => {
    const intent = intentFromPrompt("日".repeat(MAX_INTENT * 2)) as string;

    expect([...intent]).toHaveLength(MAX_INTENT);
  });

  it("rewrites nothing else: no summary, no rephrasing", () => {
    const prompt = "WHY does /api/orders 500 when the cart is empty?!";

    expect(intentFromPrompt(prompt)).toBe(prompt);
  });
});

describe("promptFromHook", () => {
  it("reads the prompt out of a Claude Code payload", () => {
    const payload = JSON.stringify({
      session_id: "abc",
      transcript_path: "/tmp/x.jsonl",
      cwd: "/repo",
      hook_event_name: "UserPromptSubmit",
      prompt: "make the tests pass",
    });

    expect(promptFromHook(payload)).toBe("make the tests pass");
  });

  it("is nothing for a payload with no prompt in it", () => {
    expect(promptFromHook(JSON.stringify({ hook_event_name: "SessionStart" }))).toBeUndefined();
  });

  it("is nothing, rather than an error, for anything unrecognisable", () => {
    // This is parsing somebody else's JSON on the way past a keystroke.
    expect(promptFromHook("")).toBeUndefined();
    expect(promptFromHook("{ not json")).toBeUndefined();
    expect(promptFromHook("[1, 2, 3]")).toBeUndefined();
    expect(promptFromHook("null")).toBeUndefined();
    expect(promptFromHook(JSON.stringify({ prompt: 7 }))).toBeUndefined();
  });

  it("reads a payload that grew fields it knows nothing about", () => {
    const payload = JSON.stringify({ prompt: "go", something_new: { nested: true } });

    expect(promptFromHook(payload)).toBe("go");
  });
});

describe("readHookPayload", () => {
  it("reads a stream to the end", async () => {
    async function* chunks(): AsyncGenerator<string> {
      yield '{"prompt":"one ';
      yield 'long prompt"}';
    }

    expect(await readHookPayload(chunks())).toBe('{"prompt":"one long prompt"}');
  });

  it("reads buffers as utf8", async () => {
    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from('{"prompt":"héllo"}', "utf8");
    }

    expect(promptFromHook(await readHookPayload(chunks()))).toBe("héllo");
  });

  it("is empty for a stream with nothing on it", async () => {
    async function* nothing(): AsyncGenerator<string> {
      // nothing at all
    }

    expect(await readHookPayload(nothing())).toBe("");
  });
});

describe("captureFromPrompt", () => {
  it("writes the first prompt into a session the hook opened", async () => {
    await appendSession(opened(), options);

    const filled = await captureFromPrompt("fix the login redirect", options);

    expect(filled?.intent).toBe("fix the login redirect");
    const [session] = await readSessions(options);
    expect(session?.intent).toBe("fix the login redirect");
    expect(session?.intentSource).toBe("captured");
  });

  it("does nothing on every prompt after the first", async () => {
    await appendSession(opened(), options);
    await captureFromPrompt("the first thing I asked", options);

    await expect(captureFromPrompt("and then this", options)).resolves.toBeUndefined();

    const [session] = await readSessions(options);
    expect(session?.intent).toBe("the first thing I asked");
  });

  it("leaves a declared intent exactly as it was declared", async () => {
    // The developer said what they were doing. What they then typed at the
    // agent is not a correction of it.
    await appendSession(declared("extract the store layer"), options);

    await expect(captureFromPrompt("actually just fix the tests", options)).resolves.toBeUndefined();

    const [session] = await readSessions(options);
    expect(session?.intent).toBe("extract the store layer");
  });

  it("does nothing when no session is open", async () => {
    await expect(captureFromPrompt("nobody is recording this", options)).resolves.toBeUndefined();
    await expect(readSessions(options)).resolves.toEqual([]);
  });

  it("waits for the next prompt when this one says nothing", async () => {
    await appendSession(opened(), options);

    await expect(captureFromPrompt("   ", options)).resolves.toBeUndefined();

    const [waiting] = await readSessions(options);
    expect(waiting?.intent).toBeNull();

    await captureFromPrompt("now the real one", options);
    const [filled] = await readSessions(options);
    expect(filled?.intent).toBe("now the real one");
  });

  it("writes one record and no more", async () => {
    const created = await appendSession(opened(), options);
    await captureFromPrompt("one prompt", options);
    await captureFromPrompt("two prompt", options);
    await captureFromPrompt("three prompt", options);

    const sessions = await readSessions(options);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(created.id);
    expect(sessions[0]?.intent).toBe("one prompt");
  });
});
