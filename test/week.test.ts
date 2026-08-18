import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DAYS,
  isEmptyFilter,
  matchesFilter,
  openInBrowser,
  parseDays,
  weekSessions,
  writeWeekPage,
} from "../src/commands/week.js";
import type { Attribution } from "../src/config.js";
import { appendSession, updateSession, type Session, type StoreOptions } from "../src/store.js";

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

describe("writeWeekPage", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = path.join(root, "tmp");
    await mkdir(tmp, { recursive: true });
  });

  it("writes the page where it says it did", async () => {
    const file = await writeWeekPage("<!doctype html><html></html>", { ...options, tmp });

    expect(path.dirname(file)).toBe(tmp);
    expect(path.basename(file)).toMatch(/^session-week-[0-9a-f]{16}\.html$/);
    await expect(readFile(file, "utf8")).resolves.toBe("<!doctype html><html></html>");
  });

  it("rewrites one page per repo rather than leaving a trail of them", async () => {
    const first = await writeWeekPage("<p>one</p>", { ...options, tmp });
    const second = await writeWeekPage("<p>two</p>", { ...options, tmp });

    expect(second).toBe(first);
    await expect(readFile(first, "utf8")).resolves.toBe("<p>two</p>");
  });

  it("gives a different repo a different page", async () => {
    const other = path.join(root, "elsewhere");
    await mkdir(other, { recursive: true });

    const mine = await writeWeekPage("<p>mine</p>", { ...options, tmp });
    const theirs = await writeWeekPage("<p>theirs</p>", { ...options, cwd: other, tmp });

    expect(theirs).not.toBe(mine);
  });

  it("keeps the page to the owner: it holds the same intents the store does", async () => {
    const file = await writeWeekPage("<p>private</p>", { ...options, tmp });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

describe("openInBrowser", () => {
  it("hands the file to the launcher it was given", async () => {
    const opened: string[] = [];

    await openInBrowser("/tmp/session-week-abc.html", {
      launch: async (file) => {
        opened.push(file);
      },
    });

    expect(opened).toEqual(["/tmp/session-week-abc.html"]);
  });

  it("surfaces a launcher that fails", async () => {
    await expect(
      openInBrowser("/tmp/page.html", {
        launch: async () => {
          throw new Error("no browser here");
        },
      }),
    ).rejects.toThrow(/no browser here/);
  });
});

describe("--client and --project", () => {
  /** Records a session for a given client and project, one day ago. */
  async function recordFor(intent: string, attribution: Attribution): Promise<void> {
    const startedAt = new Date(Date.now() - DAY_MS).toISOString();
    await appendSession({ intent, startedAt, startCommit: "abc1234", attribution }, options);
  }

  beforeEach(async () => {
    await recordFor("acme orders", { client: "Acme", project: "orders-api" });
    await recordFor("acme billing", { client: "Acme", project: "billing" });
    await recordFor("globex work", { client: "Globex", project: "orders-api" });
    await record("nobody's work", 1);
  });

  it("narrows to one client", async () => {
    const sessions = await weekSessions(7, options, { client: "Acme" });

    expect(sessions.map((session) => session.intent)).toEqual(["acme orders", "acme billing"]);
  });

  it("narrows to one project across clients", async () => {
    const sessions = await weekSessions(7, options, { project: "orders-api" });

    expect(sessions.map((session) => session.intent)).toEqual(["acme orders", "globex work"]);
  });

  it("applies both together", async () => {
    const sessions = await weekSessions(7, options, { client: "Acme", project: "orders-api" });

    expect(sessions.map((session) => session.intent)).toEqual(["acme orders"]);
  });

  it("ignores case and stray spaces, which are typed by two different people", async () => {
    const sessions = await weekSessions(7, options, { client: "  acme  " });

    expect(sessions).toHaveLength(2);
  });

  it("does not match on a prefix, which would fold two clients into one invoice", async () => {
    await recordFor("acme corp work", { client: "Acme Corporation" });

    const sessions = await weekSessions(7, options, { client: "Acme" });

    expect(sessions.map((session) => session.intent)).toEqual(["acme orders", "acme billing"]);
  });

  it("leaves out sessions that say nothing about who they were for", async () => {
    const sessions = await weekSessions(7, options, { client: "Acme" });

    expect(sessions.map((session) => session.intent)).not.toContain("nobody's work");
  });

  it("returns everything when nothing is filtered on", async () => {
    await expect(weekSessions(7, options, {})).resolves.toHaveLength(4);
    await expect(weekSessions(7, options)).resolves.toHaveLength(4);
  });

  it("is empty, not an error, when nobody matches", async () => {
    await expect(weekSessions(7, options, { client: "Initech" })).resolves.toEqual([]);
  });

  it("still respects the window", async () => {
    await appendSession(
      {
        intent: "old acme work",
        startedAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
        startCommit: "abc1234",
        attribution: { client: "Acme" },
      },
      options,
    );

    await expect(weekSessions(7, options, { client: "Acme" })).resolves.toHaveLength(2);
    await expect(weekSessions(60, options, { client: "Acme" })).resolves.toHaveLength(3);
  });
});

describe("matchesFilter", () => {
  const session = { attribution: { client: "Acme", project: "orders-api" } } as Session;

  it("passes everything when there is no filter", () => {
    expect(matchesFilter({} as Session, {})).toBe(true);
  });

  it("needs every named field to match, not just one", () => {
    expect(matchesFilter(session, { client: "Acme", project: "orders-api" })).toBe(true);
    expect(matchesFilter(session, { client: "Acme", project: "billing" })).toBe(false);
  });

  it("knows when nothing is being filtered on", () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ client: "Acme" })).toBe(false);
    expect(isEmptyFilter({ class: "ui" })).toBe(false);
  });

  it("matches on the class the session recorded", () => {
    const ui = { reality: [], class: "ui" } as unknown as Session;
    expect(matchesFilter(ui, { class: "ui" })).toBe(true);
    expect(matchesFilter(ui, { class: "api" })).toBe(false);
  });

  it("matches a session stopped before the class existed on its paths", () => {
    const old = { reality: ["src/api/orders.ts"] } as Session;
    expect(matchesFilter(old, { class: "api" })).toBe(true);
    expect(matchesFilter(old, { class: "ui" })).toBe(false);
  });
});
