import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startPassiveSession, startSession } from "../src/commands/start.js";
import {
  computeDrift,
  computeReality,
  driftOf,
  formatStopped,
  stopSession,
  type StopOptions,
} from "../src/commands/stop.js";
import { parseRates } from "../src/pricing.js";
import {
  getOpenSession,
  readSessions,
  zeroCost,
  zeroTokens,
  type Session,
  type SessionCost,
} from "../src/store.js";

const execFileAsync = promisify(execFile);

let root: string;
let cwd: string;
/** `adapters: []` keeps these tests off the machine's real transcripts. */
let options: StopOptions & { home: string; cwd: string };

/** Writes a file inside the repo, creating parent directories as needed. */
async function write(relPath: string, content = "x"): Promise<void> {
  const full = path.join(cwd, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function commitAll(message: string): Promise<void> {
  await execFileAsync("git", ["-C", cwd, "add", "-A"]);
  await execFileAsync("git", ["-C", cwd, "commit", "-q", "--no-verify", "-m", message]);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-stop-"));
  cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  options = { home: path.join(root, "store"), cwd, adapters: [] };

  await execFileAsync("git", ["init", "-q", cwd]);
  await execFileAsync("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", cwd, "config", "user.name", "Test"]);
  await write("api/orders.py", "original");
  await commitAll("first");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("computeDrift", () => {
  it("treats a trailing-slash entry as a directory prefix", () => {
    const reality = ["api/middleware/rate_limit.py"];
    expect(computeDrift(reality, ["api/middleware/"])).toEqual([]);
  });

  it("treats an entry without a trailing slash the same way", () => {
    const reality = ["api/middleware/rate_limit.py"];
    expect(computeDrift(reality, ["api/middleware"])).toEqual([]);
  });

  it("matches an exact file path", () => {
    expect(computeDrift(["api/orders.py"], ["api/orders.py"])).toEqual([]);
  });

  it("stops prefixes at directory boundaries", () => {
    // "api/order" must not swallow "api/orders.py".
    expect(computeDrift(["api/orders.py"], ["api/order"])).toEqual(["api/orders.py"]);
  });

  it("returns everything when scope is empty", () => {
    const reality = ["a.py", "b/c.py"];
    expect(computeDrift(reality, [])).toEqual(reality);
  });

  it("returns only the undeclared paths, in reality's order", () => {
    const reality = ["api/middleware/rate_limit.py", "api/orders.py", "db/schema.py"];
    expect(computeDrift(reality, ["api/orders.py", "api/middleware/"])).toEqual(["db/schema.py"]);
  });

  it("treats . as declaring the whole repo", () => {
    expect(computeDrift(["a.py", "b/c.py"], ["."])).toEqual([]);
  });
});

describe("driftOf", () => {
  const passive = { intentSource: "captured", scope: [] } as const;
  const declared = { intentSource: "declared", scope: ["api/"] } as const;

  it("is nothing for a session nobody declared a scope for", () => {
    // The empty scope means nobody was asked, not that somebody said nothing
    // would change — and calling every path drift would make the word mean
    // "changed" and empty it of the only thing it says.
    expect(driftOf(passive as never, ["api/orders.py", "db/schema.py"])).toEqual([]);
  });

  it("is the paths outside the scope for a session that declared one", () => {
    expect(driftOf(declared as never, ["api/orders.py", "db/schema.py"])).toEqual([
      "db/schema.py",
    ]);
  });

  it("is everything for a declared session that declared no scope", () => {
    // Different from a passive session: this developer was asked and said
    // nothing, so every path is outside what they declared.
    const nothing = { intentSource: "declared", scope: [] } as const;

    expect(driftOf(nothing as never, ["api/orders.py"])).toEqual(["api/orders.py"]);
  });

  it("reads a record from before capture existed as declared", () => {
    expect(driftOf({ scope: [] } as never, ["api/orders.py"])).toEqual(["api/orders.py"]);
  });
});

describe("computeReality", () => {
  it("subtracts the baseline from what changed", () => {
    expect(computeReality(["a.py", "b.py", "c.py"], ["b.py"])).toEqual(["a.py", "c.py"]);
  });

  it("is a no-op against an empty baseline", () => {
    expect(computeReality(["a.py"], [])).toEqual(["a.py"]);
  });

  it("returns nothing when the session changed only what was already dirty", () => {
    expect(computeReality(["a.py"], ["a.py", "b.py"])).toEqual([]);
  });
});

describe("stopSession", () => {
  it("records reality, drift and an end time", async () => {
    await startSession("add rate limiting to /orders", {
      ...options,
      scope: ["api/orders.py", "api/middleware/"],
    });

    await write("api/orders.py", "changed");
    await write("api/middleware/rate_limit.py");
    await write("db/schema.py");
    const before = Date.now();

    const stopped = await stopSession(options);

    expect(stopped.reality).toEqual([
      "api/middleware/rate_limit.py",
      "api/orders.py",
      "db/schema.py",
    ]);
    expect(stopped.drift).toEqual(["db/schema.py"]);
    expect(stopped.endedAt).not.toBeNull();
    expect(Date.parse(stopped.endedAt as string)).toBeGreaterThanOrEqual(before);
  });

  it("closes the session so nothing is open afterwards", async () => {
    await startSession("look around", options);
    const stopped = await stopSession(options);

    await expect(getOpenSession(options)).resolves.toBeUndefined();
    await expect(readSessions(options)).resolves.toEqual([stopped]);
  });

  it("records zero cost when no adapter finds anything, and leaves outcome open", async () => {
    await startSession("look around", options);
    await write("api/orders.py", "changed");

    const stopped = await stopSession(options);

    // Reconciled even when nothing was captured: the diff still settles that
    // this session wrote a file, so the record says which rule looked.
    expect(stopped.cost).toEqual({ ...zeroCost(), emptySource: "git" });
    expect(stopped.outcome).toBe("open");
  });

  it("records the cost an adapter reports", async () => {
    await startSession("spend some tokens", options);

    const stopped = await stopSession({
      ...options,
      adapters: [
        {
          name: "stub",
          isAvailable: async () => true,
          capture: async () => ({
            inputTokens: 1_200,
            cacheReadTokens: 70_000,
            cacheCreationTokens: 12_000,
            outputTokens: 1_000,
            turns: 3,
            apiCalls: 41,
            model: "claude-opus-5",
          }),
        },
      ],
    });

    // Nothing was written in this session, so git settles that all three turns
    // produced nothing and every token was spent inside one. That is a
    // measurement of the split, not a share of the total taken on trust.
    expect(stopped.cost).toEqual({
      inputTokens: 1_200,
      cacheReadTokens: 70_000,
      cacheCreationTokens: 12_000,
      outputTokens: 1_000,
      turns: 3,
      emptyTurns: 3,
      emptySource: "git",
      apiCalls: 41,
      model: "claude-opus-5",
      emptyTurnTokens: {
        inputTokens: 1_200,
        cacheReadTokens: 70_000,
        cacheCreationTokens: 12_000,
        outputTokens: 1_000,
      },
    });
  });

  it("records no empty-turn figure for a session that changed files", async () => {
    await startSession("spend some tokens", options);
    await write("api/orders.py", "changed");

    const stopped = await stopSession({
      ...options,
      adapters: [
        {
          name: "stub",
          isAvailable: async () => true,
          capture: async () => ({
            ...zeroCost(),
            inputTokens: 1_000,
            outputTokens: 500,
            turns: 3,
            apiCalls: 4,
            model: "claude-opus-5",
          }),
        },
      ],
    });

    // The diff says the session wrote something; nothing says which of its
    // three turns did. Absent rather than nought — a nought here is the claim
    // that no turn was wasted, and it is the claim the tool-name rule made
    // backwards for every session that worked through the shell.
    expect(stopped.cost.emptySource).toBe("git");
    expect(stopped.cost.emptyTurns).toBeUndefined();
    expect(stopped.cost.emptyTurnTokens).toBeUndefined();
    expect(stopped.cost.turns).toBe(3);
  });

  it("passes the session's own window to the adapter", async () => {
    const started = await startSession("check the window", options);
    let seen: { from: string; to: string; cwd?: string } | undefined;

    const stopped = await stopSession({
      ...options,
      adapters: [
        {
          name: "spy",
          isAvailable: async () => true,
          capture: async (window) => {
            seen = window;
            return zeroCost();
          },
        },
      ],
    });

    expect(seen?.from).toBe(started.startedAt);
    expect(seen?.to).toBe(stopped.endedAt);
    expect(seen?.cwd).toBe(cwd);
  });

  it("still closes the session when capture fails", async () => {
    await startSession("adapter blows up", options);

    const stopped = await stopSession({
      ...options,
      adapters: [
        {
          name: "broken",
          isAvailable: async () => true,
          capture: async () => {
            throw new Error("transcripts unreadable");
          },
        },
      ],
    });

    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.cost).toEqual({ ...zeroCost(), emptySource: "git", emptyTurns: 0,
      emptyTurnTokens: zeroTokens() });
  });

  it("preserves intent and scope from start", async () => {
    await startSession("the declared thing", { ...options, scope: ["api/"] });
    const stopped = await stopSession(options);

    expect(stopped.intent).toBe("the declared thing");
    expect(stopped.scope).toEqual(["api/"]);
  });

  it("records what the session was working on", async () => {
    await startSession("add rate limiting", { ...options, scope: ["api/"] });
    await write("api/routes/orders.py", "changed");
    await write("api/handlers/rate_limit.py", "new");
    await write("README.md", "notes");

    const stopped = await stopSession(options);

    // Two api files against one doc: the class is what the most of it was.
    expect(stopped.class).toBe("api");
    const [stored] = await readSessions(options);
    expect(stored?.class).toBe("api");
  });

  it("calls a session that changed nothing other, rather than guessing", async () => {
    await startSession("think about it", options);

    expect((await stopSession(options)).class).toBe("other");
  });

  it("records empty reality when nothing changed", async () => {
    await startSession("a quiet session", options);
    const stopped = await stopSession(options);

    expect(stopped.reality).toEqual([]);
    expect(stopped.drift).toEqual([]);
  });

  it("counts committed work, not just the working tree", async () => {
    await startSession("commit as you go", { ...options, scope: ["api/"] });
    await write("api/orders.py", "changed");
    await write("db/schema.py");
    await commitAll("work done during the session");

    const stopped = await stopSession(options);
    expect(stopped.reality).toEqual(["api/orders.py", "db/schema.py"]);
    expect(stopped.drift).toEqual(["db/schema.py"]);
  });

  it("excludes work that was already in the tree when the session opened", async () => {
    await write("db/schema.py", "edited before the session");
    await write("api/orders.py", "also edited before");

    await startSession("only touch middleware", { ...options, scope: ["api/middleware/"] });
    await write("api/middleware/rate_limit.py");

    const stopped = await stopSession(options);

    expect(stopped.baseline).toEqual(["api/orders.py", "db/schema.py"]);
    expect(stopped.reality).toEqual(["api/middleware/rate_limit.py"]);
    // The pre-existing edits are not drift: this session never touched them.
    expect(stopped.drift).toEqual([]);
  });

  it("reports nothing when the session changed nothing but the tree was dirty", async () => {
    await write("db/schema.py", "edited before the session");
    await startSession("a quiet session on a dirty tree", options);

    const stopped = await stopSession(options);

    expect(stopped.baseline).toEqual(["db/schema.py"]);
    expect(stopped.reality).toEqual([]);
    expect(stopped.drift).toEqual([]);
  });

  it("still credits a baseline file to the session once it is committed", async () => {
    await write("db/schema.py", "edited before the session");
    await startSession("commit the leftovers", options);
    await commitAll("commit what was already dirty");
    await write("api/orders.py", "changed by the session");

    const stopped = await stopSession(options);

    // db/schema.py stays excluded: it was dirty at start, so the session
    // cannot claim it even though it was committed during the session.
    expect(stopped.reality).toEqual(["api/orders.py"]);
  });

  it("refuses when no session is open", async () => {
    await expect(stopSession(options)).rejects.toThrow(/No session is open/);
  });

  it("refuses a second stop", async () => {
    await startSession("once", options);
    await stopSession(options);

    await expect(stopSession(options)).rejects.toThrow(/No session is open/);
  });

  it("explains itself when the start commit is gone", async () => {
    await startSession("doomed", options);
    // A fresh repo at the same path: the recorded start commit no longer exists.
    await rm(path.join(cwd, ".git"), { recursive: true, force: true });
    await execFileAsync("git", ["init", "-q", cwd]);
    await execFileAsync("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", cwd, "config", "user.name", "Test"]);
    await commitAll("unrelated");

    await expect(stopSession(options)).rejects.toThrow(/Cannot diff against the commit/);
  });
});

describe("stopping a session the hook opened", () => {
  it("records what changed and no drift at all", async () => {
    await startPassiveSession(options);
    await write("api/orders.py", "changed");
    await write("db/schema.py");

    const stopped = await stopSession(options);

    expect(stopped.reality).toEqual(["api/orders.py", "db/schema.py"]);
    expect(stopped.drift).toEqual([]);
  });

  it("classifies it from its paths like any other session", async () => {
    await startPassiveSession(options);
    await write("api/orders.py", "changed");

    expect((await stopSession(options)).class).toBe("api");
  });

  it("keeps a null intent when the session ended before any prompt arrived", async () => {
    // Nothing was declared and nothing was asked. Writing words there now
    // would be inventing them.
    await startPassiveSession(options);

    const stopped = await stopSession(options);

    expect(stopped.intent).toBeNull();
    expect(stopped.intentSource).toBe("captured");
  });

  it("says so rather than printing a blank where the intent goes", async () => {
    await startPassiveSession(options);

    expect(formatStopped(await stopSession(options))).toEqual([
      "  stopped  (no prompt)",
      "  changed  nothing",
    ]);
  });
});

describe("formatStopped", () => {
  it("lists the changed files under a stopped intent", async () => {
    await startSession("touch the api", { ...options, scope: ["api/"] });
    await write("api/orders.py", "changed");

    expect(formatStopped(await stopSession(options))).toEqual([
      "  stopped  touch the api",
      "  changed  api/orders.py",
    ]);
  });

  it("adds an outside line only when the session drifted", async () => {
    await startSession("touch the api", { ...options, scope: ["api/"] });
    await write("api/orders.py", "changed");
    await write("db/schema.py");

    expect(formatStopped(await stopSession(options))).toEqual([
      "  stopped  touch the api",
      "  changed  api/orders.py  db/schema.py",
      "  outside  db/schema.py",
    ]);
  });

  it("counts the changed files and says where, once there are more than three", async () => {
    // The same cap `show` puts on its sentence, by the same function: a reader
    // who learned the rule in one view meets the same answer in the other.
    await startSession("touch the api", { ...options, scope: ["api/"] });
    for (const name of ["orders.py", "items.py", "carts.py"]) {
      await write(`api/${name}`, "changed");
    }
    await write("db/schema.py", "changed");

    expect(formatStopped(await stopSession(options))[1]).toBe(
      "  changed  4 files, mostly in api/ and db/",
    );
  });

  it("still names them when there are three or fewer", async () => {
    await startSession("touch the api", { ...options, scope: ["api/"] });
    await write("api/orders.py", "changed");
    await write("api/items.py", "changed");

    expect(formatStopped(await stopSession(options))[1]).toBe(
      "  changed  api/items.py  api/orders.py",
    );
  });

  it("caps the outside line the same way", async () => {
    await startSession("touch the api", { ...options, scope: ["api/"] });
    for (const name of ["a.py", "b.py", "c.py", "d.py"]) {
      await write(`db/${name}`, "changed");
    }

    const lines = formatStopped(await stopSession(options));

    expect(lines[2]).toBe("  outside  4 files, all in db/");
  });

  /** Stops a session whose cost came from a stub adapter, so the model is ours to pick. */
  async function stopped(over: Partial<SessionCost>): Promise<Session> {
    await startSession("spend some tokens", { ...options, scope: ["api/"] });
    await write("api/orders.py", "changed");
    return stopSession({
      ...options,
      adapters: [
        {
          name: "stub",
          isAvailable: async () => true,
          capture: async () => ({ ...zeroCost(), ...over }),
        },
      ],
    });
  }

  it("names the model when no rate covers it, in the words week uses", async () => {
    // The reader's next move is to put a rate against that name, so the name
    // is the part that has to be here.
    const session = await stopped({ model: "mystery-9", inputTokens: 900, apiCalls: 2, turns: 1 });
    const rates = parseRates(JSON.stringify({ models: {} }), "test rates");

    expect(formatStopped(session, rates).at(-1)).toContain("900 tokens, mystery-9 unpriced");
  });

  it("says model, not an empty name, where nothing recorded which one ran", async () => {
    const session = await stopped({ model: "", inputTokens: 900, apiCalls: 2, turns: 1 });
    const rates = parseRates(JSON.stringify({ models: {} }), "test rates");

    expect(formatStopped(session, rates).at(-1)).toContain("900 tokens, model unpriced");
  });

  it("says nothing about pricing when it was handed no rates to check against", async () => {
    // "Unpriced" would then mean "nobody asked", which is a different fact.
    const session = await stopped({ model: "mystery-9", inputTokens: 900, apiCalls: 2, turns: 1 });

    expect(formatStopped(session).at(-1)).toContain("900 tokens  ");
    expect(formatStopped(session).join("\n")).not.toContain("unpriced");
  });

  it("leaves a priced session's line as the tokens it moved", async () => {
    // `stop` reports tokens; the money is what `show` and `week` are for.
    const session = await stopped({
      model: "claude-opus-5",
      inputTokens: 900,
      apiCalls: 2,
      turns: 1,
    });
    const rates = parseRates(
      JSON.stringify({
        models: { "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 } },
      }),
      "test rates",
    );

    expect(formatStopped(session, rates).at(-1)).toContain("900 tokens  ");
    expect(formatStopped(session, rates).join("\n")).not.toContain("unpriced");
  });

  it("adds a cost line reporting the token total and call counts", async () => {
    await startSession("spend some tokens", { ...options, scope: ["api/"] });
    await write("api/orders.py", "changed");

    const stopped = await stopSession({
      ...options,
      adapters: [
        {
          name: "stub",
          isAvailable: async () => true,
          capture: async () => ({
            ...zeroCost(),
            inputTokens: 1_200,
            cacheReadTokens: 70_000,
            cacheCreationTokens: 12_000,
            outputTokens: 1_000,
            turns: 3,
            apiCalls: 41,
            model: "claude-opus-5",
          }),
        },
      ],
    });

    // This session changed a file, so no count of turns that produced nothing
    // and no count of calls that wrote none: neither is on the record, and
    // both used to be printed off the tool names in the transcript.
    expect(formatStopped(stopped).at(-1)).toBe(
      "  cost     84,200 tokens  3 turns  (41 api calls)",
    );
  });

  it("omits the cost line when no adapter reported anything", async () => {
    await startSession("a quiet session", options);

    expect(formatStopped(await stopSession(options)).some((l) => l.includes("cost"))).toBe(false);
  });

  it("says nothing changed when the repo is untouched", async () => {
    await startSession("a quiet session", options);

    expect(formatStopped(await stopSession(options))[1]).toBe("  changed  nothing");
  });
});
