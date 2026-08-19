import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMark, formatSettle, markSession, settleSessions } from "../src/commands/settle.js";
import { showSession } from "../src/commands/show.js";
import { startSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { verifyLog } from "../src/commands/verify.js";
import { weekSessions } from "../src/commands/week.js";
import { readSessions, type Session, type StoreOptions } from "../src/store.js";

const execFileAsync = promisify(execFile);

let root: string;
let repo: string;
let options: StoreOptions;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function write(relPath: string, content: string): Promise<void> {
  const full = path.join(repo, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function commit(message: string): Promise<string> {
  await git("add", "-A");
  await git("-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-settle-"));
  repo = path.join(root, "work");
  await mkdir(repo, { recursive: true });
  options = { home: path.join(root, "store"), cwd: repo, adapters: [] } as StoreOptions;

  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
  await write("README.md", "start here");
  await commit("first");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Runs a session that writes `content` to `file`, on a branch of its own.
 * Leaves the branch checked out with the work committed on it.
 */
async function sessionOnBranch(branch: string, file: string, content: string): Promise<Session> {
  await git("checkout", "-q", "-b", branch);
  await startSession(`work on ${file}`, options);
  await write(file, content);
  const session = await stopSession(options);
  await commit(`add ${file}`);
  return session;
}

async function outcomeOf(session: Session): Promise<string> {
  return (await showSession(session.id, options)).outcome;
}

describe("a squash merge", () => {
  it("is read as merged, though it shares no commit with the session", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    const branchTip = await git("rev-parse", "HEAD");

    await git("checkout", "-q", "main");
    await git("merge", "--squash", "feature");
    const squashed = await commit("squashed: add src/a.ts");
    await git("branch", "-qD", "feature");

    // Nothing links the two commits, and no branch contains the original.
    // Matching on sha would find nothing and report this abandoned.
    expect(squashed).not.toBe(branchTip);
    await expect(git("branch", "--contains", branchTip)).resolves.toBe("");

    await expect(outcomeOf(session)).resolves.toBe("merged");
  });

  it("is still read as merged after later commits move the file on", async () => {
    // The session's blob is no longer at the tip. It is still in the history,
    // which is the question being asked.
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("merge", "--squash", "feature");
    await commit("squashed");
    await write("src/a.ts", "someone else rewrote it entirely");
    await commit("rewrite");

    await expect(outcomeOf(session)).resolves.toBe("merged");
  });
});

describe("a rebase merge", () => {
  it("is read as merged, though every commit was rewritten", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    const before = await git("rev-parse", "HEAD");

    await git("checkout", "-q", "main");
    await write("other.txt", "meanwhile, on main");
    await commit("unrelated");
    await git("checkout", "-q", "feature");
    await git("-c", "commit.gpgsign=false", "rebase", "-q", "main");
    const after = await git("rev-parse", "HEAD");
    await git("checkout", "-q", "main");
    await git("merge", "-q", "--ff-only", "feature");

    expect(after).not.toBe(before);
    await expect(outcomeOf(session)).resolves.toBe("merged");
  });
});

describe("an ordinary merge", () => {
  it("is read as merged", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", "merge", "feature");

    await expect(outcomeOf(session)).resolves.toBe("merged");
  });
});

describe("work that never landed", () => {
  it("is abandoned once the branch is gone and the tree is clean", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "feature");

    await expect(outcomeOf(session)).resolves.toBe("abandoned");
  });

  it("is open while it is still sitting in the working tree", async () => {
    await startSession("uncommitted work", options);
    await write("src/a.ts", "still here");
    const session = await stopSession(options);

    await expect(outcomeOf(session)).resolves.toBe("open");
  });

  it("is empty when the session changed no files at all — nothing was attempted", async () => {
    await startSession("read the code and change nothing", options);
    const session = await stopSession(options);

    expect(session.reality).toEqual([]);
    await expect(outcomeOf(session)).resolves.toBe("empty");
  });
});

describe("a deletion", () => {
  it("is merged once the file is gone from the default branch", async () => {
    await write("doomed.txt", "delete me");
    await commit("add the file");

    await git("checkout", "-q", "-b", "feature");
    await startSession("delete the file", options);
    await rm(path.join(repo, "doomed.txt"));
    const session = await stopSession(options);
    await commit("delete it");

    await git("checkout", "-q", "main");
    await git("merge", "--squash", "feature");
    await commit("squashed delete");

    expect(session.endState).toEqual({ "doomed.txt": null });
    await expect(outcomeOf(session)).resolves.toBe("merged");
  });
});

describe("settle", () => {
  it("records an observation for a session that has finished", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("merge", "--squash", "feature");
    const tip = await commit("squashed");

    const result = await settleSessions(options);

    expect(result.branch).toBe("main");
    expect(result.settled).toHaveLength(1);
    const [stored] = await readSessions(options);
    expect(stored?.observations).toEqual([
      {
        outcome: "merged",
        observedAt: expect.stringMatching(/^\d{4}-/),
        commit: tip,
        branch: "main",
        source: "computed",
      },
    ]);
    expect(session.id).toBe(stored?.id);
  });

  it("brings the stored outcome into line, so raw JSONL holds the answer", async () => {
    await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "feature");

    await settleSessions(options);

    const [stored] = await readSessions(options);
    expect(stored?.outcome).toBe("abandoned");
  });

  it("leaves a session that is still in flight alone", async () => {
    await startSession("uncommitted work", options);
    await write("src/a.ts", "still here");
    await stopSession(options);

    const result = await settleSessions(options);

    expect(result.settled).toEqual([]);
    expect(result.stillOpen).toBe(1);
    const [stored] = await readSessions(options);
    expect(stored?.observations).toBeUndefined();
  });

  it("writes nothing down for a session that changed no files", async () => {
    await startSession("read the code and change nothing", options);
    await stopSession(options);

    const result = await settleSessions(options);

    // `empty` is read off `reality` every time it is asked, so an observation
    // saying so would be a copy of a field already on the record. Counted, not
    // recorded, and not filed under "still in flight" either — it has finished.
    expect(result.settled).toEqual([]);
    expect(result.empty).toBe(1);
    expect(result.stillOpen).toBe(0);
    const [stored] = await readSessions(options);
    expect(stored?.observations).toBeUndefined();
  });

  it("says how many changed nothing", async () => {
    await startSession("read the code and change nothing", options);
    await stopSession(options);

    const lines = formatSettle(await settleSessions(options));

    expect(lines).toContain(
      "  empty    1 session changed no files, so there is nothing to have ended up anywhere",
    );
  });

  it("leaves a session that has not stopped alone", async () => {
    await startSession("still going", options);

    await expect(settleSessions(options)).resolves.toMatchObject({ settled: [], stillOpen: 1 });
  });

  it("writes nothing the second time when nothing has changed", async () => {
    await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "feature");
    await settleSessions(options);

    const again = await settleSessions(options);

    expect(again.settled[0]?.recorded).toBe(false);
    const [stored] = await readSessions(options);
    expect(stored?.observations).toHaveLength(1);
  });

  it("appends a second observation when the answer changes", async () => {
    // Abandoned on Monday, merged on Tuesday. Both are recorded, so the log
    // shows that it moved and when, rather than only the latest belief.
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await settleSessions(options);

    await git("merge", "--squash", "feature");
    await commit("squashed, at last");
    await git("branch", "-qD", "feature");
    await settleSessions(options);

    const [stored] = await readSessions(options);
    // Abandoned first: the work was committed on a branch, but a branch main
    // cannot reach is not somewhere the work has landed.
    expect(stored?.observations?.map((entry) => entry.outcome)).toEqual(["abandoned", "merged"]);
    expect(session.id).toBe(stored?.id);
  });

  it("says so when there is no branch to judge against", async () => {
    await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("branch", "-m", "main", "trunk");

    const result = await settleSessions(options);

    expect(result.branch).toBeUndefined();
    expect(formatSettle(result)[0]).toContain("none found — looked for origin/HEAD, main, master");
  });

  it("writes the observation into the signed chain", async () => {
    await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "feature");
    await settleSessions(options);

    const result = await verifyLog(options);
    expect(result.check.break).toBeUndefined();
    expect(result.check.signaturesChecked).toBe(true);
  });
});

describe("mark", () => {
  it("overrides what the repository says", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "feature");
    await expect(outcomeOf(session)).resolves.toBe("abandoned");

    // It shipped as somebody else's patch, which no amount of looking at this
    // repository would reveal.
    await markSession(session.id, "merged", options);

    await expect(outcomeOf(session)).resolves.toBe("merged");
  });

  it("refuses a session that changed no files: there is nothing to have gone anywhere", async () => {
    await startSession("read the code and change nothing", options);
    const session = await stopSession(options);

    await expect(markSession(session.id, "abandoned", options)).rejects.toThrow(
      /changed no files.*nothing was attempted/s,
    );
    await expect(markSession(session.id, "merged", options)).rejects.toThrow(/changed no files/);
    await expect(outcomeOf(session)).resolves.toBe("empty");
  });

  it("refuses empty as a mark, since nothing declares it", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");

    await expect(markSession(session.id, "empty", options)).rejects.toThrow(/not a mark/);
  });

  it("records the override as a manual observation", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");

    await markSession(session.id.slice(0, 8), "abandoned", options);

    const [stored] = await readSessions(options);
    expect(stored?.observations?.at(-1)).toMatchObject({
      outcome: "abandoned",
      source: "manual",
      branch: "main",
    });
  });

  it("survives a later settle, which cannot overrule a person", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("merge", "--squash", "feature");
    await commit("squashed");
    await markSession(session.id, "abandoned", options);

    await settleSessions(options);

    await expect(outcomeOf(session)).resolves.toBe("abandoned");
  });

  it("refuses a session that has not stopped", async () => {
    const session = await startSession("still going", options);

    await expect(markSession(session.id, "merged", options)).rejects.toThrow(/still running/);
  });

  it("refuses an id that matches nothing", async () => {
    await expect(markSession("nope", "merged", options)).rejects.toThrow(/No session with id/);
  });

  it("stays inside the signed chain", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await markSession(session.id, "merged", options);

    expect((await verifyLog(options)).check.break).toBeUndefined();
  });

  it("says what it did", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");

    const lines = formatMark(await markSession(session.id, "merged", options));

    expect(lines[0]).toBe(`  marked   ${session.id.slice(0, 8)}  merged`);
    expect(lines[1]).toContain("work on src/a.ts");
  });
});

describe("week --outcome", () => {
  it("narrows to what the repository says now, not to the stored field", async () => {
    const merged = await sessionOnBranch("one", "src/one.ts", "one");
    await git("checkout", "-q", "main");
    await git("merge", "--squash", "one");
    await commit("squashed one");
    await sessionOnBranch("two", "src/two.ts", "two");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "two");

    // Neither record has been settled, so both still say `open` on disk.
    const stored = await readSessions(options);
    expect(stored.every((session) => session.outcome === "open")).toBe(true);

    const mergedRows = await weekSessions(7, options, { outcome: "merged" });
    const abandonedRows = await weekSessions(7, options, { outcome: "abandoned" });

    expect(mergedRows.map((session) => session.id)).toEqual([merged.id]);
    expect(abandonedRows.map((session) => session.intent)).toEqual(["work on src/two.ts"]);
  });

  it("follows a manual mark", async () => {
    const session = await sessionOnBranch("feature", "src/a.ts", "the work");
    await git("checkout", "-q", "main");
    await git("branch", "-qD", "feature");
    await markSession(session.id, "merged", options);

    await expect(weekSessions(7, options, { outcome: "merged" })).resolves.toHaveLength(1);
    await expect(weekSessions(7, options, { outcome: "abandoned" })).resolves.toEqual([]);
  });
});
