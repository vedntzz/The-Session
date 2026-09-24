// A log written before write-check events existed keeps verifying, alone and with new events after it.
import { appendFile, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineHash } from "../src/chain.js";
import { verifyFailed, verifyLog } from "../src/commands/verify.js";
import { loadOrCreateKeypair } from "../src/keys.js";
import { signRecord, type RecordFields } from "../src/store.js";
import type { WriteCheckEvent } from "../src/write-check-event.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/pre-write-check/", import.meta.url));
const PUB = path.join(FIXTURE, "keys", "ed25519.pub");
const SESSION = "1a978446-0e78-41da-b24d-fd50f955c48b";

let root: string;
let log: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-migration-"));
  log = path.join(root, "log.jsonl");
  await copyFile(path.join(FIXTURE, "log.jsonl"), log);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function event(n: number, decision: WriteCheckEvent["decision"]): WriteCheckEvent {
  return { type: "write-check", n, tool: "Edit", path: "src/a.ts", decision, reason: "outside-paths", agent: "claude-code" };
}

// Appends one signed write-check record with the writer's own signing, onto the fixture's key.
async function appendEvent(check: WriteCheckEvent): Promise<void> {
  const lines = (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
  const keypair = await loadOrCreateKeypair(FIXTURE);
  const set = { writeCheck: check } as unknown as RecordFields;
  const record = signRecord(SESSION, set, lineHash(lines.at(-1) as string), keypair);
  await appendFile(log, `${JSON.stringify(record)}\n`, "utf8");
}

describe("a log from before write-check events", () => {
  it("verifies against its key, legacy line counted as unsigned", async () => {
    const result = await verifyLog({ log, key: PUB });
    expect(result.check).toMatchObject({ total: 3, unsigned: 1, verified: 2, signaturesChecked: true });
    expect(verifyFailed(result)).toBe(false);
  });

  it("verifies with write-check events chained after it, old lines untouched", async () => {
    const before = await readFile(log, "utf8");
    await appendEvent(event(1, "deny"));
    await appendEvent(event(2, "ask"));
    const result = await verifyLog({ log, key: PUB });
    expect(result.check).toMatchObject({ total: 5, unsigned: 1, verified: 4 });
    expect(result.check.break).toBeUndefined();
    expect((await readFile(log, "utf8")).startsWith(before)).toBe(true);
  });

  it("fails when a write-check event is edited", async () => {
    await appendEvent(event(1, "deny"));
    await appendEvent(event(2, "ask"));
    const text = await readFile(log, "utf8");
    await writeFile(log, text.replace('"decision":"deny"', '"decision":"silent"'), "utf8");
    const result = await verifyLog({ log, key: PUB });
    expect(result.check.break).toMatchObject({ line: 4, kind: "hash" });
    expect(verifyFailed(result)).toBe(true);
  });
});
