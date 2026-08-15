import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showSession } from "../src/commands/show.js";
import { appendSession, updateSession, type Session, type StoreOptions } from "../src/store.js";

let root: string;
let options: StoreOptions & { home: string; cwd: string };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-show-"));
  // No git repo here: `show` only reads the log, so the store key falls back
  // to the directory path and nothing else is needed.
  options = { home: path.join(root, "store"), cwd: root };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Adds a session that ran from `startedAt`, closing it unless told otherwise. */
async function record(
  intent: string,
  startedAt: string,
  extra: { endedAt?: string | null; id?: string } = {},
): Promise<Session> {
  const session = await appendSession(
    { intent, startedAt, startCommit: "abc1234", ...(extra.id ? { id: extra.id } : {}) },
    options,
  );
  const endedAt = extra.endedAt === undefined ? new Date(Date.parse(startedAt) + 1).toISOString() : extra.endedAt;
  if (endedAt === null) {
    return session;
  }
  return updateSession(session.id, { endedAt }, options);
}

describe("showSession", () => {
  it("returns the last closed session", async () => {
    await record("the first thing", "2026-01-15T09:00:00.000Z");
    await record("the last thing", "2026-01-15T14:00:00.000Z");

    await expect(showSession(undefined, options)).resolves.toMatchObject({
      intent: "the last thing",
    });
  });

  it("skips a session that is still running", async () => {
    await record("the last closed thing", "2026-01-15T09:00:00.000Z");
    await record("still going", "2026-01-15T14:00:00.000Z", { endedAt: null });

    await expect(showSession(undefined, options)).resolves.toMatchObject({
      intent: "the last closed thing",
    });
  });

  it("refuses when nothing has been recorded at all", async () => {
    await expect(showSession(undefined, options)).rejects.toThrow(/No closed sessions yet/);
  });

  it("refuses when the only session is still running", async () => {
    await record("still going", "2026-01-15T09:00:00.000Z", { endedAt: null });

    await expect(showSession(undefined, options)).rejects.toThrow(/No closed sessions yet/);
  });

  it("returns the session named by a full id", async () => {
    const wanted = await record("the first thing", "2026-01-15T09:00:00.000Z");
    await record("the last thing", "2026-01-15T14:00:00.000Z");

    await expect(showSession(wanted.id, options)).resolves.toMatchObject({
      intent: "the first thing",
    });
  });

  it("accepts an unambiguous prefix of an id", async () => {
    await record("the first thing", "2026-01-15T09:00:00.000Z", { id: "aaaa1111" });
    await record("the last thing", "2026-01-15T14:00:00.000Z", { id: "bbbb2222" });

    await expect(showSession("aaaa", options)).resolves.toMatchObject({
      intent: "the first thing",
    });
  });

  it("refuses an ambiguous prefix rather than guessing", async () => {
    await record("one", "2026-01-15T09:00:00.000Z", { id: "aaaa1111" });
    await record("two", "2026-01-15T14:00:00.000Z", { id: "aaaa2222" });

    await expect(showSession("aaaa", options)).rejects.toThrow(/matches 2 sessions/);
  });

  it("prefers an exact id over a longer one it is a prefix of", async () => {
    await record("the short id", "2026-01-15T09:00:00.000Z", { id: "aaaa" });
    await record("the long id", "2026-01-15T14:00:00.000Z", { id: "aaaa1111" });

    await expect(showSession("aaaa", options)).resolves.toMatchObject({ intent: "the short id" });
  });

  it("refuses an id it has never seen", async () => {
    await record("the only thing", "2026-01-15T09:00:00.000Z");

    await expect(showSession("nope", options)).rejects.toThrow(/No session with id nope/);
  });

  it("shows a session by id even while it is still running", async () => {
    const open = await record("still going", "2026-01-15T09:00:00.000Z", { endedAt: null });

    await expect(showSession(open.id, options)).resolves.toMatchObject({ endedAt: null });
  });
});
