import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { debtReport, readAllSessions } from "../src/commands/debt.js";
import { MIN_HISTORY } from "../src/debt.js";
import { parseRates, type RateTable } from "../src/pricing.js";
import { plainPalette } from "../src/render/palette.js";
import { formatDebt, NOTHING_RECORDED } from "../src/render/terminal.js";
import {
  appendSession,
  updateSession,
  zeroCost,
  type Session,
  type StoreOptions,
} from "../src/store.js";

/**
 * The half that reads the disk, and the half a person reads.
 *
 * Separate from `test/debt.test.ts`, which tests the aggregation with
 * literals. What is checked here is what only real logs can show — that every
 * repository's log is read rather than the current one's, and that the view
 * never prints a nought where it means "nobody knows".
 */

const RATES: RateTable = parseRates(
  JSON.stringify({
    models: { "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 } },
  }),
  "test rates",
);

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-debt-"));
  home = path.join(root, "store");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Options pointing at one checkout inside the temp root. Two of these are two
 * repositories, because the store key falls back to the directory path when
 * there is no git remote.
 */
function repo(name: string): StoreOptions & { home: string; cwd: string } {
  return { home, cwd: path.join(root, name) };
}

let day = 0;

/** Records one closed session in a repo, with the scope and drift given. */
async function record(options: StoreOptions, fields: Partial<Session> = {}): Promise<Session> {
  day += 1;
  const startedAt = new Date(Date.UTC(2026, 0, day, 12, 0, 0)).toISOString();
  const session = await appendSession(
    { intent: "add rate limiting", startedAt, startCommit: "abc1234", scope: fields.scope ?? [] },
    options,
  );
  return updateSession(
    session.id,
    {
      reality: fields.drift ?? [],
      drift: fields.drift ?? [],
      cost: {
        ...zeroCost(),
        inputTokens: 200_000,
        turns: 4,
        apiCalls: 8,
        model: fields.cost?.model ?? "claude-opus-5",
      },
      endedAt: new Date(Date.parse(startedAt) + DAY_MS / 4).toISOString(),
    },
    options,
  );
}

describe("readAllSessions", () => {
  it("reads every repository's log, not just the one it was run from", async () => {
    await record(repo("one"));
    await record(repo("two"));

    // Asked from inside `one`, and `two`'s session is there all the same.
    const sessions = await readAllSessions(repo("one"));
    expect(new Set(sessions.map((session) => session.repo)).size).toBe(2);
  });

  it("treats a store that does not exist yet as no sessions", async () => {
    expect(await readAllSessions({ home: path.join(root, "nothing"), cwd: root })).toEqual([]);
  });
});

describe("debtReport", () => {
  it("finds a file three of a repo's sessions drifted onto", async () => {
    const one = repo("one");
    await record(one, { drift: ["src/store.ts"] });
    await record(one, { drift: ["src/store.ts"] });
    await record(one, { drift: ["src/store.ts", "src/git.ts"] });

    const report = await debtReport(RATES, one);
    expect(report.repos).toHaveLength(1);
    expect(report.repos[0]?.files?.map((file) => file.path)).toEqual(["src/store.ts"]);
  });

  it("never pools two repositories' drift onto one path", async () => {
    for (const name of ["one", "two", "three"]) {
      await record(repo(name), { drift: ["src/store.ts"] });
      await record(repo(name), { drift: ["src/store.ts"] });
    }

    const report = await debtReport(RATES, repo("one"));
    expect(report.repos).toHaveLength(3);
    // Six sessions drifted onto that path across the machine, and no repo owes
    // it: two apiece is under the threshold, and the threshold is per repo.
    expect(report.repos.flatMap((entry) => entry.files ?? [])).toEqual([]);
  });
});

describe("formatDebt", () => {
  /** The report a repo with these sessions produces, rendered. */
  async function rendered(fields: Partial<Session>[] = []): Promise<string[]> {
    const one = repo("one");
    for (const session of fields) {
      await record(one, session);
    }
    return formatDebt(await debtReport(RATES, one), plainPalette);
  }

  it("says so on a machine with nothing recorded", async () => {
    expect(await rendered()).toEqual(["", `  ${NOTHING_RECORDED}`]);
  });

  it("declines to judge a repo with too little history", async () => {
    const lines = await rendered([{ drift: ["src/store.ts"] }, { drift: ["src/store.ts"] }]);

    expect(lines.join("\n")).toContain(
      `not enough history to judge — 2 sessions recorded, ${MIN_HISTORY} needed`,
    );
    // Not a list of nothing dressed up as an all-clear.
    expect(lines.join("\n")).not.toContain("no file drifted");
  });

  it("says a repo owes nothing once there is history to say it from", async () => {
    const lines = await rendered([
      { drift: ["src/a.ts"] },
      { drift: ["src/b.ts"] },
      { drift: ["src/c.ts"] },
    ]);

    expect(lines.join("\n")).toContain("no file drifted into 3 or more times");
    expect(lines.join("\n")).toContain("3 sessions of history");
  });

  it("lays the table out with the file, the count, the day and the cost", async () => {
    const drift = { drift: ["src/store.ts"] };
    const lines = await rendered([drift, drift, drift]);

    expect(lines).toContain("  file          sessions drifted  last touched   cost");
    expect(
      lines.some((line) => /^ {2}src\/store\.ts {17}3 {4}2026-01-\d\d {2}\$3\.00$/.test(line)),
    ).toBe(true);
  });

  it("says the cost column does not add up, because it does not", async () => {
    const drift = { drift: ["src/store.ts", "src/git.ts"] };
    const lines = await rendered([drift, drift, drift]);

    // One session, two rows: summing the column would bill it twice.
    expect(lines.join("\n")).toContain("cost is the whole of every session that touched the file");
    expect(lines.join("\n")).toContain("docs, config, build files are never listed");
  });

  it("prints a dash, not a nought, for a file nothing could be priced", async () => {
    const drift = { drift: ["src/store.ts"], cost: { model: "gpt-9" } as Session["cost"] };
    const lines = await rendered([drift, drift, drift]);

    expect(lines.some((line) => line.includes("src/store.ts") && line.endsWith("—"))).toBe(true);
    expect(lines.join("\n")).not.toContain("$0.00");
    expect(lines.join("\n")).toContain("no rate covers: gpt-9");
    // The whole file to write, not a pointer at a format nobody knows.
    expect(lines.join("\n")).toContain('"cacheCreation": 0');
  });

  it("prints no legend under a report that listed nothing", async () => {
    const lines = await rendered([{}, {}, {}]);

    expect(lines.join("\n")).not.toContain("does not add up");
  });

  it("carries no colour, and no total across repositories", async () => {
    const drift = { drift: ["src/store.ts"] };
    const lines = await rendered([drift, drift, drift]);

    expect(lines.join("\n")).not.toContain("[");
    expect(lines.join("\n")).not.toMatch(/total/i);
  });
});
