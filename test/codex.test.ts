// The Codex adapter, read against one real rollout with its text redacted.
import { copyFile, mkdir, mkdtemp, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_COST } from "../src/capture/adapter.js";
import { costOfTurns, createCodexAdapter, defaultCodexRoot } from "../src/capture/adapters/codex.js";
import { emptyRollout, foldRolloutLine, turnsOf } from "../src/capture/adapters/codex-rollout.js";

const NAME = "rollout-2026-09-23T19-24-04-01a0d095-5bd9-7d73-871a-b6756ea97139.jsonl";
const FIXTURE = path.join(import.meta.dirname, "fixtures/codex", NAME);
// The fixture's three turns start at 23:24:50 (gpt-5.6-sol), 23:25:37 and 23:27:18 (gpt-6-astra).
const WHOLE = { from: "2026-09-23T23:24:00Z", to: "2026-09-23T23:30:00Z", cwd: "/work/repo" };

let root: string;
beforeEach(async () => {
  root = path.join(await mkdtemp(path.join(tmpdir(), "codex-")), "sessions");
  const day = path.join(root, "2026/09/23");
  await mkdir(day, { recursive: true });
  await copyFile(FIXTURE, path.join(day, NAME));
  const written = new Date("2026-09-24T00:00:00Z");
  await utimes(path.join(day, NAME), written, written);
});

const capture = (window: { from: string; to: string; cwd?: string }) => createCodexAdapter({ root }).capture(window);

describe("the Codex adapter", () => {
  it("counts every turn a rollout started inside the window, each with the tokens it recorded", async () => {
    const cost = await capture(WHOLE);
    expect(cost).toMatchObject({ turns: 3, apiCalls: 0 });
    expect(cost.untokenedTurns).toBeUndefined();
  });

  it("records the model per turn when it switches mid-thread", async () => {
    const cost = await capture(WHOLE);
    expect(cost.turnModels).toEqual(["gpt-5.6-sol", "gpt-6-astra", "gpt-6-astra"]);
    expect(cost.model).toBe("gpt-6-astra");
  });

  it("keeps only the turns whose context falls inside the window", async () => {
    const cost = await capture({ ...WHOLE, to: "2026-09-23T23:25:00Z" });
    expect(cost).toMatchObject({ turns: 1, turnModels: ["gpt-5.6-sol"] });
    expect(await capture({ ...WHOLE, from: "2026-09-23T23:30:01Z", to: "2026-09-23T23:40:00Z" })).toEqual(NO_COST);
  });

  it("ignores a rollout whose cwd is another repo, and claims one from a subdirectory", async () => {
    expect(await capture({ ...WHOLE, cwd: "/work/other" })).toEqual(NO_COST);
    expect(await capture({ ...WHOLE, cwd: "/work/repo-2" })).toEqual(NO_COST);
    expect((await capture({ ...WHOLE, cwd: "/work/repo/src" })).turns).toBe(3);
  });

  it("skips a rollout last written before the window opened", async () => {
    const old = new Date("2026-09-01T00:00:00Z");
    await utimes(path.join(root, "2026/09/23", NAME), old, old);
    expect(await capture(WHOLE)).toEqual(NO_COST);
  });

  it("finds nothing, and is unavailable, where Codex has never run", async () => {
    const adapter = createCodexAdapter({ root: path.join(root, "missing") });
    expect(await adapter.isAvailable()).toBe(false);
    expect(await adapter.capture(WHOLE)).toEqual(NO_COST);
  });

  it("reads CODEX_HOME for the rollout root", () => {
    const saved = process.env["CODEX_HOME"];
    process.env["CODEX_HOME"] = "/elsewhere/codex";
    expect(defaultCodexRoot()).toBe("/elsewhere/codex/sessions");
    if (saved === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = saved;
  });
});

describe("a rollout line", () => {
  const at = "2026-09-25T22:46:58.909Z";
  const line = (type: string, payload: object) => JSON.stringify({ timestamp: at, type, payload });
  const started = (turn: string) => line("event_msg", { type: "task_started", turn_id: turn });
  const context = (turn: string, model?: string) => line("turn_context", { turn_id: turn, model });
  const fold = (lines: string[]) => {
    const rollout = emptyRollout();
    for (const text of lines) foldRolloutLine(rollout, text);
    return turnsOf(rollout);
  };

  it("counts a turn by its task_started, once, however often its context is written", () => {
    const turns = fold([started("t1"), context("t1", "m"), context("t1", "other"), "{not json", ""]);
    expect(turns.map((turn) => [turn.id, turn.model])).toEqual([["t1", "m"]]);
  });

  it("counts a prompt with no turn_context as one turn with a null model", () => {
    const user = line("response_item", { type: "message", role: "user", content: [] });
    const turns = fold([line("session_meta", { id: "x", cwd: "/work/repo" }), started("t9"), user]);
    expect(turns).toEqual([{ id: "t9", at: Date.parse(at), model: null, tokens: null }]);
    expect(costOfTurns(turns)).toMatchObject({ turns: 1, untokenedTurns: 1, turnModels: [null], model: "" });
  });

  // Tripwire: imports are recognised by the `external-import-` prefix alone. If Codex renames it, this fails.
  it("skips an imported turn, counting it apart, beside a real one", () => {
    const turns = fold([started("external-import-turn-1"), started("t1"), context("t1", "gpt-6-astra")]);
    expect(costOfTurns(turns)).toMatchObject({ turns: 1, untokenedTurns: 1, importedTurnsSkipped: 1, turnModels: ["gpt-6-astra"] });
  });

  it("reports a window of nothing but imports as no turns, with the imports counted", () => {
    const cost = costOfTurns(fold([started("external-import-turn-1"), started("external-import-turn-2")]));
    expect(cost).toMatchObject({ turns: 0, importedTurnsSkipped: 2 });
    expect(cost.untokenedTurns).toBeUndefined();
    expect(cost.turnModels).toBeUndefined();
  });

  it("names no model where the context names none, and counts no turn from a context alone", () => {
    expect(fold([started("t1"), context("t1")]).map((turn) => turn.model)).toEqual([null]);
    expect(fold([context("t2", "m")])).toEqual([]);
  });

  it("is committed with no prompt, message or local path in it", async () => {
    const text = await readFile(FIXTURE, "utf8");
    expect(text).not.toMatch(/\/Users\/|\/home\//);
    const strings = JSON.parse(`[${text.trim().split("\n").join(",")}]`) as unknown[];
    const texts = JSON.stringify(strings).match(/"text":"[^"]*"/g) ?? [];
    expect(texts.every((field) => field === '"text":"[redacted]"')).toBe(true);
  });
});
