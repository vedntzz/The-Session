import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";
import {
  emptySourceOf,
  emptyTokensOf,
  emptyTurnsOf,
  emptyTurnsTotal,
  reconcileEmpty,
  unmeasuredEmpty,
} from "../src/empty.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

const execFileAsync = promisify(execFile);

/**
 * Which turns produced nothing, against a transcript Claude Code actually
 * wrote.
 *
 * `test/fixtures/claude-code-bash-session.jsonl` is thirty lines lifted
 * verbatim out of `~/.claude/projects` — two developer prompts, the sixteen
 * assistant entries they set off, the eleven tool results between them, and one
 * line of a type this reader does not parse. Nothing in it was written by hand,
 * and that is the whole point of it being here.
 *
 * It was recorded by running a real Claude Code session in a throwaway git
 * repository that did nothing but write two shell scripts, so the only path it
 * contains is that repository's own and every command in it prints a word or a
 * digit. A transcript is the one thing this tool promises never leaves the
 * machine it was written on; a fixture is a transcript in a public repository,
 * so it has to be one nobody minds publishing.
 *
 * The old rule called a turn productive when an `Edit`, `Write`, `MultiEdit`
 * or `NotebookEdit` block appeared in it. This transcript contains none: every
 * file in it was written through `Bash` — a `printf` into a redirect, an
 * append, a `chmod` — which is how most files get written, and the survey that
 * found this bug put `Bash` at three times the use of `Edit`. So a session that
 * changed seven files was recorded as two turns of two empty and twenty-eight
 * calls of twenty-eight without edits: every figure about waste reading 100%
 * for a session that did all of its work.
 *
 * A hand-written fixture could not have caught it. One would have been built
 * from the same assumption the rule was — an `Edit` block where an edit
 * happened — and it would have passed.
 */

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "claude-code-bash-session.jsonl",
);

/** The instants the fixture spans, so a window can be put round all of it. */
const WINDOW = { from: "2026-09-01T18:52:17.572Z", to: "2026-09-01T18:52:58.909Z" };

let root: string;

beforeEach(async () => {
  // The adapter walks `<root>/<project>/*.jsonl`, which is the layout Claude
  // Code keeps. The fixture is copied in rather than read directly, so the
  // test exercises the same directory walk a real machine does.
  root = await mkdtemp(path.join(tmpdir(), "session-empty-"));
  await mkdir(path.join(root, "a-project"), { recursive: true });
  await cp(FIXTURE, path.join(root, "a-project", "transcript.jsonl"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The fixture, read through the adapter that reads real transcripts. */
async function captured(): Promise<SessionCost> {
  return createClaudeCodeAdapter({ root }).capture(WINDOW);
}

/** A closed session carrying a cost, with whatever the test needs over it. */
function session(over: Partial<Session> = {}): Session {
  return {
    id: "1f99d065",
    repo: "path:/tmp/work",
    intent: "fix the template wording",
    intentSource: "declared",
    scope: [],
    baseline: [],
    reality: ["src/render/pr.ts"],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: WINDOW.from,
    endedAt: WINDOW.to,
    startCommit: "abc1234",
    ...over,
  };
}

describe("the fixture", () => {
  it("is a real transcript that wrote its files through the shell", async () => {
    const text = await readFile(FIXTURE, "utf8");
    const entries = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const tools = entries
      .filter((entry) => entry["type"] === "assistant")
      .flatMap((entry) => {
        const content = (entry["message"] as Record<string, unknown>)["content"];
        return Array.isArray(content) ? content : [];
      })
      .filter((block) => block?.type === "tool_use")
      .map((block) => block.name as string);

    // The shape that produced the bug, pinned so a fixture swapped for a
    // tidier one cannot quietly stop covering it.
    expect(tools).toContain("Bash");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("MultiEdit");
    expect(tools).not.toContain("NotebookEdit");
    // Real streaming: more assistant entries than calls, several fragments to
    // a request. Nothing hand-written has this by accident.
    expect(entries.filter((entry) => entry["type"] === "assistant").length).toBe(16);
    // Every path in it belongs to the throwaway repository it was recorded in.
    // A fixture is a transcript in a public repository, and a transcript is the
    // one thing this tool promises stays on the machine that wrote it.
    const paths = text.match(/\/(?:private|Users|home|var|opt|etc|root)[\w./-]*/gu) ?? [];
    expect([...new Set(paths)]).toEqual(["/private/tmp/session-fixture-repo"]);
  });
});

describe("what the adapter reports", () => {
  it("counts turns, calls and tokens, and says nothing about what was produced", async () => {
    const cost = await captured();

    expect(cost.turns).toBe(2);
    expect(cost.apiCalls).toBe(13);
    expect(cost.model).toBe("claude-opus-5");
    expect(cost.cacheReadTokens).toBe(204_751);
    expect(cost.outputTokens).toBe(1566);

    // The three figures a transcript cannot answer. Absent, not nought: a
    // nought here is the claim that no turn and no call was wasted.
    expect(cost.emptyTurns).toBeUndefined();
    expect(cost.callsWithoutEdits).toBeUndefined();
    expect(cost.emptyTurnTokens).toBeUndefined();
    expect(cost.emptySource).toBeUndefined();
  });

  it("collapses streaming fragments into one call, as it always did", async () => {
    const text = await readFile(FIXTURE, "utf8");
    const assistants = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry["type"] === "assistant").length;

    // Sixteen entries, thirteen calls. Adding usage up per fragment would
    // multiply the bill by however many pieces the network split it into.
    expect(assistants).toBe(16);
    expect((await captured()).apiCalls).toBe(13);
  });
});

describe("reconciling against git", () => {
  it("refuses to say which turns were empty when the session changed files", async () => {
    const cost = reconcileEmpty(await captured(), true);
    const closed = session({ cost, reality: ["src/render/pr.ts", "test/pr.test.ts"] });

    expect(emptySourceOf(cost)).toBe("git");
    // The regression. Under the old rule this session read 2 of 2 turns empty
    // and its whole spend as waste, because no call named an editing tool.
    expect(cost.emptyTurns).toBeUndefined();
    expect(emptyTurnsOf(closed)).toBeUndefined();
    expect(emptyTokensOf(closed)).toBeUndefined();
  });

  it("counts every turn as empty when the session changed nothing", async () => {
    const cost = reconcileEmpty(await captured(), false);
    const closed = session({ cost, reality: [] });

    expect(emptySourceOf(cost)).toBe("git");
    expect(emptyTurnsOf(closed)).toBe(2);
    // A measurement, not a share: every token moved was moved in a turn that
    // ended with nothing written, so the waste is the session's own total.
    expect(emptyTokensOf(closed)).toEqual({
      inputTokens: cost.inputTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheCreationTokens: cost.cacheCreationTokens,
      outputTokens: cost.outputTokens,
    });
  });

  it("marks the record, so a reader can tell which rule wrote the figure", async () => {
    expect(reconcileEmpty(await captured(), true).emptySource).toBe("git");
    expect(reconcileEmpty(await captured(), false).emptySource).toBe("git");
    // Absent reads as the old tool-name rule, the same shape `intentSource`
    // uses for records written before it existed.
    expect(emptySourceOf(zeroCost())).toBe("tools");
  });
});

describe("records written under the old rule", () => {
  it("refuses the figure git can prove wrong", () => {
    // What the old rule wrote for a shell-driven session: every turn empty,
    // over a session that changed files. It cannot both be true.
    const old = session({
      cost: { ...zeroCost(), turns: 2, apiCalls: 28, emptyTurns: 2, callsWithoutEdits: 28 },
      reality: ["src/render/pr.ts"],
    });

    expect(emptySourceOf(old.cost)).toBe("tools");
    expect(emptyTurnsOf(old)).toBeUndefined();
  });

  it("keeps a figure git does not contradict", () => {
    // Three of ten, from a session that did use Edit and Write. Unprovable
    // either way now, and throwing it away would discard the months of them
    // that are right.
    const old = session({
      cost: { ...zeroCost(), turns: 10, apiCalls: 40, emptyTurns: 3 },
      reality: ["src/render/pr.ts"],
    });

    expect(emptyTurnsOf(old)).toBe(3);
  });

  it("counts every turn where the session changed nothing, whatever it recorded", () => {
    const old = session({
      cost: { ...zeroCost(), turns: 4, apiCalls: 9, emptyTurns: 1 },
      reality: [],
    });

    // git settles it: nothing was written, so no turn wrote anything. The
    // stored 1 was the tool-name rule miscounting, and it is not consulted.
    expect(emptyTurnsOf(old)).toBe(4);
  });
});

describe("totalling across sessions", () => {
  it("adds up when every session can be counted", () => {
    const sessions = [
      session({ cost: { ...zeroCost(), turns: 3 }, reality: [] }),
      session({ cost: { ...zeroCost(), turns: 10, emptyTurns: 2 }, reality: ["a.ts"] }),
    ];

    expect(emptyTurnsTotal(sessions)).toBe(5);
    expect(unmeasuredEmpty(sessions)).toBe(0);
  });

  it("gives no total at all when one of them cannot be counted", async () => {
    const sessions = [
      session({ cost: { ...zeroCost(), turns: 3 }, reality: [] }),
      session({ cost: reconcileEmpty(await captured(), true), reality: ["a.ts"] }),
    ];

    // Not 3. A total that quietly left the unmeasured session out would be
    // smaller than the truth and would look exactly like a complete one.
    expect(emptyTurnsTotal(sessions)).toBeUndefined();
    expect(unmeasuredEmpty(sessions)).toBe(1);
  });
});

describe("stop, end to end", () => {
  let repo: string;

  beforeEach(async () => {
    repo = path.join(root, "work");
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["init", "-q", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "Test"]);
    await execFileAsync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "first"]);
  });

  /** The fixture's cost, as `stop` would receive it from the adapter. */
  async function adapter() {
    const cost = await captured();
    return [{ name: "fixture", isAvailable: async () => true, capture: async () => cost }];
  }

  it("records no empty-turn figure for a session that wrote files", async () => {
    const { startSession } = await import("../src/commands/start.js");
    const { stopSession } = await import("../src/commands/stop.js");
    const store = { home: path.join(root, "store"), cwd: repo };

    await startSession("write something", store);
    await execFileAsync("bash", ["-c", `printf 'x\\n' > ${path.join(repo, "made.txt")}`]);
    const stopped = await stopSession({ ...store, adapters: await adapter() });

    expect(stopped.reality).toEqual(["made.txt"]);
    expect(stopped.cost.emptySource).toBe("git");
    expect(stopped.cost.emptyTurns).toBeUndefined();
    expect(stopped.cost.callsWithoutEdits).toBeUndefined();
    expect(emptyTurnsOf(stopped)).toBeUndefined();
  });

  it("records every turn as empty for a session that wrote nothing", async () => {
    const { startSession } = await import("../src/commands/start.js");
    const { stopSession } = await import("../src/commands/stop.js");
    const store = { home: path.join(root, "store"), cwd: repo };

    await startSession("look around", store);
    const stopped = await stopSession({ ...store, adapters: await adapter() });

    expect(stopped.reality).toEqual([]);
    expect(stopped.cost.emptySource).toBe("git");
    expect(stopped.cost.emptyTurns).toBe(2);
    expect(emptyTurnsOf(stopped)).toBe(2);
  });
});
