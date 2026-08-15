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

describe("appendSession / readSessions", () => {
  it("round-trips a session and generates an id", async () => {
    const written = await appendSession({ start: T.start, note: "first" }, options);
    expect(written.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(readSessions(options)).resolves.toEqual([written]);
  });

  it("returns an empty list when no log exists", async () => {
    await expect(readSessions(options)).resolves.toEqual([]);
  });

  it("writes one JSONL line per call and never rewrites earlier lines", async () => {
    const first = await appendSession({ start: T.start }, options);
    await appendSession({ start: T.later }, options);
    await updateSession(first.id, { end: T.end }, options);

    const file = await resolveStoreFile(options);
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(3);

    const firstRecord = JSON.parse(lines[0]!) as { id: string; set: Record<string, unknown> };
    expect(firstRecord.id).toBe(first.id);
    expect(firstRecord.set["end"]).toBeUndefined();
  });

  it("sorts by start time, not by write order", async () => {
    await appendSession({ start: T.later, note: "afternoon" }, options);
    await appendSession({ start: T.start, note: "morning" }, options);

    const notes = (await readSessions(options)).map((session) => session.note);
    expect(notes).toEqual(["morning", "afternoon"]);
  });

  it("rejects a non-ISO start", async () => {
    await expect(appendSession({ start: "yesterday" }, options)).rejects.toThrow(/ISO-8601/);
  });

  it("keeps concurrent appends intact", async () => {
    const starts = Array.from({ length: 20 }, (_, i) =>
      new Date(Date.parse(T.start) + i * 60_000).toISOString(),
    );
    await Promise.all(starts.map((start) => appendSession({ start }, options)));

    const sessions = await readSessions(options);
    expect(sessions).toHaveLength(20);
    expect(sessions.map((s) => s.start)).toEqual(starts);
  });
});

describe("updateSession", () => {
  it("folds a patch over the existing session", async () => {
    const created = await appendSession({ start: T.start, note: "wip" }, options);
    const updated = await updateSession(created.id, { end: T.end }, options);

    expect(updated).toEqual({ id: created.id, start: T.start, note: "wip", end: T.end });
    await expect(readSessions(options)).resolves.toEqual([updated]);
  });

  it("applies patches in order, last write winning", async () => {
    const created = await appendSession({ start: T.start, note: "a" }, options);
    await updateSession(created.id, { note: "b" }, options);
    await updateSession(created.id, { note: "c" }, options);

    const [session] = await readSessions(options);
    expect(session?.note).toBe("c");
  });

  it("throws on an unknown id", async () => {
    await expect(updateSession("nope", { end: T.end }, options)).rejects.toThrow(/no session with id/);
  });
});

describe("getOpenSession", () => {
  it("returns undefined when nothing is open", async () => {
    const created = await appendSession({ start: T.start }, options);
    await updateSession(created.id, { end: T.end }, options);

    await expect(getOpenSession(options)).resolves.toBeUndefined();
  });

  it("returns the session without an end", async () => {
    const closed = await appendSession({ start: T.start }, options);
    await updateSession(closed.id, { end: T.end }, options);
    const open = await appendSession({ start: T.later }, options);

    await expect(getOpenSession(options)).resolves.toEqual(open);
  });

  it("prefers the most recently started when several are open", async () => {
    await appendSession({ start: T.start }, options);
    const newest = await appendSession({ start: T.later }, options);

    await expect(getOpenSession(options)).resolves.toEqual(newest);
  });
});

describe("log durability", () => {
  it("tolerates a truncated final line", async () => {
    const kept = await appendSession({ start: T.start }, options);
    const file = await resolveStoreFile(options);
    await writeFile(file, (await readFile(file, "utf8")) + '{"v":1,"id":"x","se', "utf8");

    await expect(readSessions(options)).resolves.toEqual([kept]);
  });

  it("throws on corruption before the final line", async () => {
    await appendSession({ start: T.start }, options);
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
    await appendSession({ start: T.start }, options);
    await appendSession({ start: T.later }, options);

    await expect(readdir(home)).resolves.toHaveLength(1);
  });

  it("shares one store across a repo's subdirectories", async () => {
    await execFileAsync("git", ["init", "-q", cwd]);
    await execFileAsync("git", ["-C", cwd, "remote", "add", "origin", "git@github.com:acme/tool.git"]);
    const nested = path.join(cwd, "packages", "core");
    await mkdir(nested, { recursive: true });

    const created = await appendSession({ start: T.start }, { home, cwd });
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
