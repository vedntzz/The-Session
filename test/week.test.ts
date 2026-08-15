import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DAYS, parseDays, weekSessions } from "../src/commands/week.js";
import { appendSession, updateSession, type StoreOptions } from "../src/store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let options: StoreOptions & { home: string; cwd: string };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-week-"));
  // No git repo needed: `week` only reads the log, and the store key falls
  // back to the directory path.
  options = { home: path.join(root, "store"), cwd: root };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Records a closed session that started `daysAgo` days ago. */
async function record(intent: string, daysAgo: number): Promise<void> {
  const startedAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const session = await appendSession({ intent, startedAt, startCommit: "abc1234" }, options);
  await updateSession(
    session.id,
    { endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString() },
    options,
  );
}

function intents(sessions: { intent: string }[]): string[] {
  return sessions.map((session) => session.intent);
}

describe("parseDays", () => {
  it("defaults to a week", () => {
    expect(parseDays()).toBe(DEFAULT_DAYS);
    expect(DEFAULT_DAYS).toBe(7);
  });

  it("takes a whole number of days", () => {
    expect(parseDays("30")).toBe(30);
    expect(parseDays("1")).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDays(" 14 ")).toBe(14);
  });

  it.each(["0", "-3", "2.5", "abc", "", "7d"])("refuses %o", (value) => {
    expect(() => parseDays(value)).toThrow(/whole number of days/);
  });
});

describe("weekSessions", () => {
  it("returns the sessions inside the window, oldest first", async () => {
    await record("six days ago", 6);
    await record("two days ago", 2);
    await record("this morning", 0);

    expect(intents(await weekSessions(7, options))).toEqual([
      "six days ago",
      "two days ago",
      "this morning",
    ]);
  });

  it("leaves out what started before the window", async () => {
    await record("nine days ago", 9);
    await record("two days ago", 2);

    expect(intents(await weekSessions(7, options))).toEqual(["two days ago"]);
  });

  it("widens with --days", async () => {
    await record("twenty days ago", 20);
    await record("two days ago", 2);

    expect(intents(await weekSessions(30, options))).toEqual([
      "twenty days ago",
      "two days ago",
    ]);
  });

  it("narrows with --days", async () => {
    await record("three days ago", 3);
    await record("this morning", 0);

    expect(intents(await weekSessions(1, options))).toEqual(["this morning"]);
  });

  it("defaults to a week", async () => {
    await record("nine days ago", 9);
    await record("two days ago", 2);

    expect(intents(await weekSessions(undefined, options))).toEqual(["two days ago"]);
  });

  it("includes a session that is still running", async () => {
    await appendSession(
      { intent: "still going", startedAt: new Date().toISOString(), startCommit: "abc1234" },
      options,
    );

    const sessions = await weekSessions(7, options);
    expect(intents(sessions)).toEqual(["still going"]);
    expect(sessions[0]?.endedAt).toBeNull();
  });

  it("returns nothing when the log is empty", async () => {
    await expect(weekSessions(7, options)).resolves.toEqual([]);
  });

  it("returns nothing when every session is older than the window", async () => {
    await record("last month", 40);

    await expect(weekSessions(7, options)).resolves.toEqual([]);
  });
});
