// Every synced session record, read off refs/session/* into one flat list.
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../../src/store.js";
import { commitTree, refFor, updateRef, writeBlob, writeTree } from "../../src/sync.js";
import { listSessionRefs, loadTeamRecords } from "../../src/team/load-team-records.js";
import { session } from "../fixtures/markdown.js";
import { createStartRepo } from "../fixtures/start-repo.js";

const exec = promisify(execFile);
const MACHINE_A = refFor("ed25519:aaaa");
const MACHINE_B = refFor("ed25519:bbbb");
let root: string;
let cwd: string;

/** One unsigned creating record per session, as a log line. */
function logOf(sessions: readonly (Session & Record<string, unknown>)[]): string {
  return sessions.map(({ id, ...set }) => JSON.stringify({ v: 1, id, at: set.startedAt, set }) + "\n").join("");
}

/** Publishes `text` as the log under `ref`, the way `session push` stores it. */
async function publish(ref: string, text: string): Promise<void> {
  const tree = await writeTree(cwd, await writeBlob(cwd, text));
  await updateRef(cwd, ref, await commitTree(cwd, tree, undefined, "session push"), undefined);
}

beforeEach(async () => {
  ({ root, cwd } = await createStartRepo());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listSessionRefs", () => {
  it("ignores branches and tags", async () => {
    await exec("git", ["-C", cwd, "tag", "v1"]);
    await exec("git", ["-C", cwd, "branch", "feature"]);
    await publish(MACHINE_A, "");
    expect(await listSessionRefs(cwd)).toEqual([MACHINE_A]);
  });
});

describe("loadTeamRecords", () => {
  it("returns nothing when no session refs exist", async () => {
    expect(await loadTeamRecords(cwd)).toEqual([]);
  });

  it("returns every record from every ref, tagged with its ref, by start time", async () => {
    const tool = "remote:github.com/acme/tool";
    const site = "remote:github.com/acme/site";
    await publish(MACHINE_A, logOf([
      session({ id: "a1", repo: tool, startedAt: "2026-10-01T09:00:00.000Z" }),
      session({ id: "a2", repo: site, startedAt: "2026-10-03T09:00:00.000Z" }),
    ]));
    await publish(MACHINE_B, logOf([session({ id: "b1", repo: site, startedAt: "2026-10-02T09:00:00.000Z" })]));
    const records = await loadTeamRecords(cwd);
    expect(records.map((record) => [record.id, record.repo, record.sourceRef])).toEqual([
      ["a1", tool, MACHINE_A],
      ["b1", site, MACHINE_B],
      ["a2", site, MACHINE_A],
    ]);
  });

  it("reads no records from branches or tags", async () => {
    await exec("git", ["-C", cwd, "tag", "v1"]);
    await exec("git", ["-C", cwd, "branch", "feature"]);
    expect(await loadTeamRecords(cwd)).toEqual([]);
  });

  it("names a ref it cannot read instead of skipping it", async () => {
    const head = (await exec("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
    await updateRef(cwd, MACHINE_B, head, undefined);
    await expect(loadTeamRecords(cwd)).rejects.toThrow(MACHINE_B);
  });

  it("names a ref whose log is corrupt", async () => {
    await publish(MACHINE_A, "not json\n");
    await expect(loadTeamRecords(cwd)).rejects.toThrow(MACHINE_A);
  });

  it("strips name, email and author even when the stored record has them", async () => {
    const personal = { name: "Ada", email: "ada@example.com", author: "Ada <ada@example.com>" };
    await publish(MACHINE_A, logOf([{ ...session({ id: "a1" }), ...personal }]));
    const [record] = await loadTeamRecords(cwd);
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty("email");
    expect(record).not.toHaveProperty("author");
    expect(record).not.toHaveProperty("name");
  });
});
