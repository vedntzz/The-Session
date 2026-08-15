import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../src/commands/start.js";
import { computeDrift, formatStopped, stopSession } from "../src/commands/stop.js";
import { getOpenSession, readSessions } from "../src/store.js";

const execFileAsync = promisify(execFile);

let root: string;
let cwd: string;
let options: { home: string; cwd: string };

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
  options = { home: path.join(root, "store"), cwd };

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

  it("leaves cost at zeros and outcome open", async () => {
    await startSession("look around", options);
    await write("api/orders.py", "changed");

    const stopped = await stopSession(options);

    expect(stopped.cost).toEqual({ tokens: 0, runs: 0, emptyRuns: 0, model: "" });
    expect(stopped.outcome).toBe("open");
  });

  it("preserves intent and scope from start", async () => {
    await startSession("the declared thing", { ...options, scope: ["api/"] });
    const stopped = await stopSession(options);

    expect(stopped.intent).toBe("the declared thing");
    expect(stopped.scope).toEqual(["api/"]);
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

  it("says nothing changed when the repo is untouched", async () => {
    await startSession("a quiet session", options);

    expect(formatStopped(await stopSession(options))[1]).toBe("  changed  nothing");
  });
});
