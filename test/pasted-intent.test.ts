// A pasted first prompt. Claude Code hands UserPromptSubmit the pasted text
// inside an opening `<pasted_content id="…">` tag with no closing tag; the tag
// is its markup, the text after it is what the developer asked.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrapPastes } from "../src/capture/adapters/claude-prompt.js";
import { captureFromPrompt, promptFromHook } from "../src/commands/intent.js";
import { intentOf, noIntentSentence } from "../src/render/terminal/intent.js";
import {
  appendSession, captureIntent, readSessions, recordIntentMissing, resolveStoreFile, updateSession,
  type NewSession, type SessionPatch, type StoreOptions,
} from "../src/store.js";

const HEAD = "cdd3b4f0000000000000000000000000000000ab";
const PASTED = '\n\n<pasted_content id="fa6a">\nSet up the Jev contract on master.\nTypes only.';
const PASTE_ONLY = '<pasted_content id="9e34">\n';

let root: string;
let options: StoreOptions;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-pasted-"));
  const cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  options = { home: path.join(root, "store"), cwd };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const opened = (): NewSession =>
  ({ startedAt: "2026-09-27T09:00:00.000Z", intent: null, intentSource: "captured", startCommit: HEAD, scope: [] });

async function forge(id: string, set: Record<string, unknown>): Promise<void> {
  const file = await resolveStoreFile(options);
  const line = JSON.stringify({ v: 1, id, at: "2026-09-27T10:00:00.000Z", set });
  await writeFile(file, `${await readFile(file, "utf8")}${line}\n`, "utf8");
}

describe("unwrapPastes", () => {
  it("keeps the pasted text and drops the tag around it", () => {
    expect(unwrapPastes(PASTED)).toEqual({ text: "\n\n\nSet up the Jev contract on master.\nTypes only.", pasteOnly: false });
  });

  it("keeps words typed before a paste", () => {
    expect(unwrapPastes('fix this:\n<pasted_content id="ab12">\nTypeError: x').text).toBe("fix this:\n\nTypeError: x");
  });

  it("drops a closing tag too, should one ever arrive", () => {
    expect(unwrapPastes('<pasted_content id="ab12">the text</pasted_content>').text).toBe("the text");
  });

  it("is paste-only when the tag holds no text", () => {
    expect(unwrapPastes(PASTE_ONLY).pasteOnly).toBe(true);
    expect(unwrapPastes('<pasted_content id="ab12"></pasted_content>  ').pasteOnly).toBe(true);
  });

  it("leaves a prompt that only talks about the tag alone", () => {
    const prompt = "why does <pasted_content> show up in my intents?";
    expect(unwrapPastes(prompt)).toEqual({ text: prompt, pasteOnly: false });
  });

  it("is not paste-only for a prompt with nothing in it: that one simply said nothing", () => {
    expect(unwrapPastes("   ").pasteOnly).toBe(false);
  });
});

describe("capturing a pasted first prompt", () => {
  it("records the pasted text as the intent, never the tag", async () => {
    await appendSession(opened(), options);
    const prompt = promptFromHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: PASTED }));

    await captureFromPrompt(prompt ?? "", options);

    const [session] = await readSessions(options);
    expect(session?.intent).toBe("Set up the Jev contract on master. Types only.");
    expect(session?.intentMissing).toBeUndefined();
  });

  it("records a paste with no text as not captured, with the reason, and never the tag", async () => {
    await appendSession(opened(), options);

    await captureFromPrompt(PASTE_ONLY, options);

    const [session] = await readSessions(options);
    expect(session?.intent).toBeNull();
    expect(session?.intentMissing).toBe("paste-only");
    expect(await readFile(await resolveStoreFile(options), "utf8")).not.toContain("pasted_content");
  });

  it("does not fill the intent from a later prompt: that was not the first thing asked", async () => {
    await appendSession(opened(), options);
    await captureFromPrompt(PASTE_ONLY, options);

    await expect(captureFromPrompt("and now some words", options)).resolves.toBeUndefined();

    const [session] = await readSessions(options);
    expect(session?.intent).toBeNull();
    expect(session?.intentMissing).toBe("paste-only");
  });

  it("leaves a record that already holds the tag exactly as it was written", async () => {
    const legacy = '<pasted_content id="69d7"> Sat 19 Clickable prototype';
    const created = await appendSession(opened(), options);
    await captureIntent(created.id, legacy, options);

    const [session] = await readSessions(options);
    expect(session?.intent).toBe(legacy);
  });
});

describe("recordIntentMissing", () => {
  it("refuses a session that already has an intent, or already has a reason", async () => {
    const created = await appendSession(opened(), options);
    await recordIntentMissing(created.id, "paste-only", options);
    await expect(recordIntentMissing(created.id, "paste-only", options)).rejects.toThrow(/written once/);

    const other = await appendSession({ ...opened(), startedAt: "2026-09-27T09:30:00.000Z" }, options);
    await captureIntent(other.id, "fix the redirect", options);
    await expect(recordIntentMissing(other.id, "paste-only", options)).rejects.toThrow(/written once/);
  });

  it("closes the intent to captureIntent and to updateSession", async () => {
    const created = await appendSession(opened(), options);
    await recordIntentMissing(created.id, "paste-only", options);

    await expect(captureIntent(created.id, "words", options)).rejects.toThrow(/written once/);
    await expect(updateSession(created.id, { intentMissing: undefined } as SessionPatch, options)).rejects.toThrow(/written once/);
  });

  it("is kept by the fold against a later record that claims words, and cannot be added over words", async () => {
    const missing = await appendSession(opened(), options);
    await recordIntentMissing(missing.id, "paste-only", options);
    await forge(missing.id, { intent: "words written afterwards" });

    const worded = await appendSession({ ...opened(), startedAt: "2026-09-27T09:30:00.000Z" }, options);
    await captureIntent(worded.id, "the first prompt", options);
    await forge(worded.id, { intentMissing: "paste-only" });

    const [first, second] = await readSessions(options);
    expect(first).toMatchObject({ intent: null, intentMissing: "paste-only" });
    expect(second?.intent).toBe("the first prompt");
    expect(second?.intentMissing).toBeUndefined();
  });
});

describe("how a view names it", () => {
  it("says the pasted text was not captured, apart from a session nobody prompted", () => {
    expect(intentOf({ intent: null, intentMissing: "paste-only", endedAt: null })).toBe("(pasted text not captured)");
    expect(intentOf({ intent: null, endedAt: null })).toBe("(no prompt yet)");
  });

  it("says so in the brief view's sentence, rather than that nothing was asked", () => {
    expect(noIntentSentence({ intentMissing: "paste-only", endedAt: null })).toMatch(/^The first prompt was pasted text/);
    expect(noIntentSentence({ endedAt: null })).toBe("Nothing has been asked yet.");
  });
});
