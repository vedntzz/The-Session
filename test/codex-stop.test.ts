// `stop` with the Codex adapter: turns recorded where a rollout ran here, a clean close where none did.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/capture/adapters/codex.js";
import { defaultAdapters } from "../src/capture/index.js";
import { startSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { emptyTurnsOf } from "../src/empty.js";
import { priceSession, wasMeasured } from "../src/pricing.js";

const RATE = { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 };

const git = promisify(execFile);
let root: string;
let cwd: string;
let codex: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "codex-stop-"));
  cwd = path.join(root, "work");
  codex = path.join(root, "codex", "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(codex, { recursive: true });
  await git("git", ["init", "-q", cwd]);
  await writeFile(path.join(cwd, "a.txt"), "x");
  await git("git", ["-C", cwd, "add", "-A"]);
  await git("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const options = () => ({ home: path.join(root, "store"), cwd, adapters: [createCodexAdapter({ root: codex })] });

/** A rollout for this repo with one turn per model, each started now. */
async function rollout(models: string[]): Promise<void> {
  const day = path.join(codex, "2026", "09", "28");
  await mkdir(day, { recursive: true });
  const at = new Date().toISOString();
  const lines = [{ timestamp: at, type: "session_meta", payload: { id: "t", cwd } },
    ...models.flatMap((model, i) => [
      { timestamp: at, type: "event_msg", payload: { type: "task_started", turn_id: `turn-${i}` } },
      { timestamp: at, type: "turn_context", payload: { turn_id: `turn-${i}`, model, cwd } },
    ])];
  await writeFile(path.join(day, "rollout-2026-09-28T00-00-00-t.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
}

describe("stop with the Codex adapter", () => {
  it("is registered beside Claude Code", () => {
    expect(defaultAdapters().map((adapter) => adapter.name)).toEqual(["claude-code", "codex"]);
  });

  it("still closes the session where no rollout ran", async () => {
    await startSession("nothing from codex", options());
    const stopped = await stopSession(options());
    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.cost.turns).toBe(0);
    expect(stopped.cost.untokenedTurns).toBeUndefined();
  });

  it("records each turn's model, and git decides the turns produced nothing", async () => {
    await startSession("ask codex", options());
    await rollout(["gpt-5.6-sol", "gpt-6-astra"]);
    const stopped = await stopSession(options());
    expect(stopped.cost).toMatchObject({ turns: 2, untokenedTurns: 2, turnModels: ["gpt-5.6-sol", "gpt-6-astra"] });
    expect(emptyTurnsOf(stopped)).toBe(2);
    expect(wasMeasured(stopped.cost)).toBe(true); // captured: turns were seen
    expect(priceSession(stopped.cost, new Map([["gpt-5.6-sol", RATE], ["gpt-6-astra", RATE]])).priced).toBe(false);
  });

  it("takes reality from git, whatever the rollout said", async () => {
    await startSession("codex edits", options());
    await rollout(["gpt-6-astra"]);
    await writeFile(path.join(cwd, "a.txt"), "changed");
    const stopped = await stopSession(options());
    expect(stopped.reality).toEqual(["a.txt"]);
    expect(emptyTurnsOf(stopped)).toBeUndefined();
  });
});
