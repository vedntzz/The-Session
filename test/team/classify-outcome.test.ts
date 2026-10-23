// TM-2: each team record lands in one bucket of OutcomeSplit, by the rule the PR card uses.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { endStateOf } from "../../src/git.js";
import { factsFor } from "../../src/observe.js";
import type { RepoFacts } from "../../src/outcome.js";
import { zeroCost, type Session, type SessionOutcome } from "../../src/store.js";
import { BUCKET_OF_OUTCOME, classifyOutcome, countOutcomes, isWaste } from "../../src/team/classify-outcome.js";
import type { TeamRecord } from "../../src/team/load-team-records.js";
import type { OutcomeSplit } from "../../src/team/team-report.js";

const run = promisify(execFile);
let repo: string;

async function git(...args: string[]): Promise<string> {
  return (await run("git", ["-C", repo, ...args])).stdout.trim();
}

async function commit(file: string, content: string): Promise<string> {
  await writeFile(path.join(repo, file), content, "utf8");
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", file);
  return git("rev-parse", "HEAD");
}

/** A stopped session that changed `paths` from `startCommit`, as the working tree holds them now. */
async function stopped(id: string, startCommit: string, paths: string[]): Promise<Session> {
  return { id, repo: "r", intent: "work", scope: [], baseline: [], reality: paths, drift: [], cost: zeroCost(),
    outcome: "open", startedAt: "2026-10-03T09:00:00Z", endedAt: "2026-10-03T10:00:00Z", startCommit,
    endState: await endStateOf(paths, repo) };
}

const markedAbandoned = (session: Session): Session => ({ ...session, observations: [
  { outcome: "abandoned", observedAt: "2026-10-04T09:00:00Z", commit: "abc", branch: "main", source: "manual" }] });

const asRecord = (session: Session): TeamRecord => ({ ...session, sourceRef: "refs/session/a" });

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "session-team-outcome-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

/** One session per outcome, and the facts the repository gives for all of them. */
async function fixture(): Promise<{ sessions: Record<SessionOutcome, Session>; facts: RepoFacts | undefined }> {
  const start = await commit("base.txt", "base\n");
  await writeFile(path.join(repo, "shipped.txt"), "shipped\n", "utf8");
  const merged = await stopped("merged", start, ["shipped.txt"]);
  await commit("shipped.txt", "shipped\n");
  await writeFile(path.join(repo, "draft.txt"), "draft\n", "utf8");
  const open = await stopped("open", start, ["draft.txt"]);
  const abandoned = markedAbandoned(await stopped("abandoned", start, ["gone.txt"]));
  const empty = await stopped("empty", start, []);
  const sessions = { merged, open, abandoned, empty };
  return { sessions, facts: await factsFor(Object.values(sessions), repo) };
}

describe("classifyOutcome", () => {
  it("puts a merged session nothing reverted in shipped", async () => {
    const { sessions, facts } = await fixture();
    expect(classifyOutcome(sessions.merged, facts, false)).toBe("shipped");
  });

  it("puts a merged session flagged as reverted in reverted", async () => {
    const { sessions, facts } = await fixture();
    expect(classifyOutcome(sessions.merged, facts, true)).toBe("reverted");
  });

  it("puts an abandoned session in neverMerged", async () => {
    const { sessions, facts } = await fixture();
    expect(classifyOutcome(sessions.abandoned, facts, false)).toBe("neverMerged");
  });

  it("puts an open session in stillOpen, and stillOpen is never waste", async () => {
    const { sessions, facts } = await fixture();
    expect(classifyOutcome(sessions.open, facts, false)).toBe("stillOpen");
    expect(isWaste("stillOpen")).toBe(false);
  });

  it("puts an empty session in noChanges", async () => {
    const { sessions, facts } = await fixture();
    expect(classifyOutcome(sessions.empty, facts, false)).toBe("noChanges");
  });

  it("does not let a reverted flag move a session that never merged", async () => {
    const { sessions, facts } = await fixture();
    expect(classifyOutcome(sessions.open, facts, true)).toBe("stillOpen");
  });
});

describe("isWaste", () => {
  it("counts only work that was paid for and did not stay in the branch", () => {
    const buckets: (keyof OutcomeSplit)[] = ["shipped", "reverted", "neverMerged", "stillOpen", "noChanges"];
    expect(buckets.filter(isWaste)).toEqual(["reverted", "neverMerged"]);
  });
});

describe("BUCKET_OF_OUTCOME", () => {
  it("maps every outcome, so a new one will not compile until it is mapped", () => {
    expectTypeOf(BUCKET_OF_OUTCOME).toEqualTypeOf<Readonly<Record<SessionOutcome, keyof OutcomeSplit>>>();
    expect(Object.keys(BUCKET_OF_OUTCOME).sort()).toEqual(["abandoned", "empty", "merged", "open"]);
  });
});

describe("countOutcomes", () => {
  it("counts each record once, in its bucket", async () => {
    const { sessions, facts } = await fixture();
    const records = [sessions.merged, sessions.merged, sessions.open, sessions.abandoned, sessions.empty].map(asRecord);
    expect(countOutcomes(records, facts)).toEqual({ shipped: 2, reverted: 0, neverMerged: 1, stillOpen: 1, noChanges: 1 });
  });

  it("counts nothing for no records", () => {
    expect(countOutcomes([], undefined)).toEqual({ shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 });
  });
});
