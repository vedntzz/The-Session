import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendSession,
  getOpenSession,
  normalizeRemoteUrl,
  readSessions,
  repoKey,
  resolveStoreFile,
  updateSession,
  zeroCost,
  type NewSession,
  type SessionPatch,
  type StoreOptions,
} from "../src/store.js";

const execFileAsync = promisify(execFile);

let home: string;
let cwd: string;
let options: StoreOptions;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "session-test-"));
  home = path.join(root, "store");
  cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  options = { home, cwd };
});

afterEach(async () => {
  await rm(path.dirname(home), { recursive: true, force: true });
});

const T = {
  start: "2026-08-15T09:00:00.000Z",
  end: "2026-08-15T11:30:00.000Z",
  later: "2026-08-15T14:00:00.000Z",
};

const COST = {
  inputTokens: 1_200,
  cacheReadTokens: 9_000,
  cacheCreationTokens: 2_000,
  outputTokens: 300,
  turns: 2,
  emptyTurns: 1,
  apiCalls: 4,
  callsWithoutEdits: 1,
  model: "claude-opus-5",
};
const HEAD = "cdd3b4f0000000000000000000000000000000ab";

/** A session as `session start` would open it: intent, scope, HEAD, nothing else. */
function started(intent: string, startedAt = T.start): NewSession {
  return { startedAt, intent, startCommit: HEAD };
}

describe("appendSession / readSessions", () => {
  it("round-trips a session and generates an id", async () => {
    const written = await appendSession(started("fix the parser"), options);
    expect(written.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(readSessions(options)).resolves.toEqual([written]);
  });

  it("round-trips every field, arrays and cost included", async () => {
    const written = await appendSession(
      {
        startedAt: T.start,
        endedAt: T.end,
        intent: "extract the store layer",
        scope: ["src/store.ts"],
        reality: ["src/store.ts", "src/cli.ts"],
        drift: ["src/cli.ts"],
        cost: COST,
        outcome: "merged",
        startCommit: HEAD,
      },
      options,
    );

    await expect(readSessions(options)).resolves.toEqual([written]);
  });

  it("defaults the fields a session cannot know at start", async () => {
    const written = await appendSession(started("look around"), options);

    expect(written).toEqual({
      id: written.id,
      repo: written.repo,
      intent: "look around",
      scope: [],
      baseline: [],
      reality: [],
      drift: [],
      cost: zeroCost(),
      outcome: "open",
      startedAt: T.start,
      endedAt: null,
      startCommit: HEAD,
    });
  });

  it("derives repo from the store's cwd", async () => {
    await execFileAsync("git", ["init", "-q", cwd]);
    await execFileAsync("git", ["-C", cwd, "remote", "add", "origin", "git@github.com:acme/tool.git"]);

    const written = await appendSession(started("identify me"), options);
    expect(written.repo).toBe("remote:github.com/acme/tool");
  });

  it("returns an empty list when no log exists", async () => {
    await expect(readSessions(options)).resolves.toEqual([]);
  });

  it("writes one JSONL line per call and never rewrites earlier lines", async () => {
    const first = await appendSession(started("a"), options);
    await appendSession(started("b", T.later), options);
    await updateSession(first.id, { endedAt: T.end }, options);

    const file = await resolveStoreFile(options);
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(3);

    const firstRecord = JSON.parse(lines[0]!) as { id: string; set: Record<string, unknown> };
    expect(firstRecord.id).toBe(first.id);
    // Still open on the line that created it: the later patch went to line 3.
    expect(firstRecord.set["endedAt"]).toBeNull();
  });

  it("sorts by start time, not by write order", async () => {
    await appendSession(started("afternoon", T.later), options);
    await appendSession(started("morning", T.start), options);

    const intents = (await readSessions(options)).map((session) => session.intent);
    expect(intents).toEqual(["morning", "afternoon"]);
  });

  it("rejects a non-ISO startedAt", async () => {
    await expect(appendSession(started("whenever", "yesterday"), options)).rejects.toThrow(
      /ISO-8601/,
    );
  });

  it("keeps concurrent appends intact", async () => {
    const starts = Array.from({ length: 20 }, (_, i) =>
      new Date(Date.parse(T.start) + i * 60_000).toISOString(),
    );
    await Promise.all(
      starts.map((startedAt) => appendSession(started("concurrent", startedAt), options)),
    );

    const sessions = await readSessions(options);
    expect(sessions).toHaveLength(20);
    expect(sessions.map((s) => s.startedAt)).toEqual(starts);
  });
});

describe("updateSession", () => {
  it("folds a patch over the existing session", async () => {
    const created = await appendSession(started("wip"), options);
    const updated = await updateSession(created.id, { endedAt: T.end }, options);

    expect(updated).toEqual({ ...created, endedAt: T.end });
    await expect(readSessions(options)).resolves.toEqual([updated]);
  });

  it("closes out a session with the fields gathered along the way", async () => {
    const created = await appendSession(
      { ...started("extract the store layer"), scope: ["src/store.ts"] },
      options,
    );
    const closed = await updateSession(
      created.id,
      {
        endedAt: T.end,
        reality: ["src/store.ts", "test/store.test.ts"],
        drift: ["tests came along for the ride"],
        cost: COST,
        outcome: "merged",
      },
      options,
    );

    expect(closed.scope).toEqual(["src/store.ts"]);
    expect(closed.outcome).toBe("merged");
    expect(closed.cost).toEqual(COST);
    await expect(readSessions(options)).resolves.toEqual([closed]);
  });

  it("replaces arrays wholesale rather than merging them", async () => {
    const created = await appendSession(
      { ...started("narrow the blast radius"), scope: ["a.ts", "b.ts"] },
      options,
    );
    await updateSession(created.id, { scope: ["c.ts"] }, options);

    const [session] = await readSessions(options);
    expect(session?.scope).toEqual(["c.ts"]);
  });

  it("applies patches in order, last write winning", async () => {
    const created = await appendSession(started("a"), options);
    await updateSession(created.id, { outcome: "abandoned" }, options);
    await updateSession(created.id, { outcome: "merged" }, options);

    const [session] = await readSessions(options);
    expect(session?.outcome).toBe("merged");
  });

  it("throws on an unknown id", async () => {
    await expect(updateSession("nope", { endedAt: T.end }, options)).rejects.toThrow(
      /no session with id/,
    );
  });

  it("refuses to edit intent, which is written once at start", async () => {
    const created = await appendSession(started("what I said"), options);

    await expect(
      updateSession(created.id, { intent: "what I wish I had said" } as SessionPatch, options),
    ).rejects.toThrow(/written once/);

    const [session] = await readSessions(options);
    expect(session?.intent).toBe("what I said");
  });
});

describe("getOpenSession", () => {
  it("returns undefined when nothing is running", async () => {
    const created = await appendSession(started("done"), options);
    await updateSession(created.id, { endedAt: T.end }, options);

    await expect(getOpenSession(options)).resolves.toBeUndefined();
  });

  it("returns the session with a null endedAt", async () => {
    const closed = await appendSession(started("done"), options);
    await updateSession(closed.id, { endedAt: T.end }, options);
    const open = await appendSession(started("still going", T.later), options);

    await expect(getOpenSession(options)).resolves.toEqual(open);
  });

  it("prefers the most recently started when several are running", async () => {
    await appendSession(started("older"), options);
    const newest = await appendSession(started("newer", T.later), options);

    await expect(getOpenSession(options)).resolves.toEqual(newest);
  });

  it("ignores outcome, which tracks where a session landed, not whether it runs", async () => {
    const created = await appendSession(started("stopped but unmerged"), options);
    await updateSession(created.id, { endedAt: T.end, outcome: "open" }, options);

    await expect(getOpenSession(options)).resolves.toBeUndefined();
  });
});

describe("log durability", () => {
  it("tolerates a truncated final line", async () => {
    const kept = await appendSession(started("kept"), options);
    const file = await resolveStoreFile(options);
    await writeFile(file, (await readFile(file, "utf8")) + '{"v":1,"id":"x","se', "utf8");

    await expect(readSessions(options)).resolves.toEqual([kept]);
  });

  it("throws on corruption before the final line", async () => {
    await appendSession(started("kept"), options);
    const file = await resolveStoreFile(options);
    await writeFile(file, `{ oops\n${await readFile(file, "utf8")}`, "utf8");

    await expect(readSessions(options)).rejects.toThrow(/corrupt JSON/);
  });
});

describe("repo key", () => {
  it("collapses equivalent remote forms", () => {
    const canonical = normalizeRemoteUrl("https://github.com/acme/tool.git");
    expect(normalizeRemoteUrl("git@github.com:acme/tool.git")).toBe(canonical);
    expect(normalizeRemoteUrl("ssh://git@github.com/acme/tool")).toBe(canonical);
    expect(normalizeRemoteUrl("https://user:pw@github.com/acme/Tool/")).toBe(canonical);
    expect(normalizeRemoteUrl("https://github.com/acme/other")).not.toBe(canonical);
  });

  it("is a stable hex digest", async () => {
    const key = await repoKey(cwd);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    await expect(repoKey(cwd)).resolves.toBe(key);
  });

  it("keys off the absolute path outside a repo", async () => {
    const elsewhere = await mkdtemp(path.join(tmpdir(), "session-other-"));
    try {
      expect(await repoKey(cwd)).not.toBe(await repoKey(elsewhere));
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("writes exactly one file per repo", async () => {
    await appendSession(started("one"), options);
    await appendSession(started("two", T.later), options);

    await expect(readdir(home)).resolves.toHaveLength(1);
  });

  it("shares one store across a repo's subdirectories", async () => {
    await execFileAsync("git", ["init", "-q", cwd]);
    await execFileAsync("git", ["-C", cwd, "remote", "add", "origin", "git@github.com:acme/tool.git"]);
    const nested = path.join(cwd, "packages", "core");
    await mkdir(nested, { recursive: true });

    const created = await appendSession(started("shared"), { home, cwd });
    await expect(readSessions({ home, cwd: nested })).resolves.toEqual([created]);
  });

  it("matches the same repo cloned over https", async () => {
    await execFileAsync("git", ["init", "-q", cwd]);
    await execFileAsync("git", ["-C", cwd, "remote", "add", "origin", "git@github.com:acme/tool.git"]);

    const clone = await mkdtemp(path.join(tmpdir(), "session-clone-"));
    try {
      await execFileAsync("git", ["init", "-q", clone]);
      await execFileAsync("git", [
        "-C",
        clone,
        "remote",
        "add",
        "origin",
        "https://github.com/acme/tool.git",
      ]);
      expect(await repoKey(clone)).toBe(await repoKey(cwd));
    } finally {
      await rm(clone, { recursive: true, force: true });
    }
  });
});
