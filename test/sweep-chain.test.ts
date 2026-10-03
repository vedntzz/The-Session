// SES-7: a torn write, and the write after it.
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { verifyLog } from "../src/commands/verify.js";
import { acknowledgedTorn } from "../src/store/torn.js";
import { appendSession, readSessions, resolveStoreFile, updateSession, type StoreOptions } from "../src/store.js";

let root: string;
let options: StoreOptions;
const TORN = '{"v":1,"id":"x","at":"2026-10-03T09:00:00Z","set":{"endedAt"';

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "session-sweep-chain-")));
  const cwd = path.join(root, "repo");
  await mkdir(cwd);
  await runGit(cwd, ["init", "-q"]);
  options = { home: path.join(root, "store"), cwd };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const start = (intent: string) => appendSession({ intent, startedAt: "2026-10-03T09:00:00Z", startCommit: "abc" }, options);

describe("SES-7: a write cut short, then another", () => {
  it("leaves the log readable and verified, naming the torn line", async () => {
    const session = await start("first");
    await appendFile(await resolveStoreFile(options), TORN);
    await updateSession(session.id, { endedAt: "2026-10-03T10:00:00Z" }, options);

    expect((await readSessions(options))[0]).toMatchObject({ intent: "first", endedAt: "2026-10-03T10:00:00Z" });
    const { check } = await verifyLog(options);
    expect(check).toMatchObject({ total: 2, verified: 2, torn: [2] });
    expect(check.break).toBeUndefined();
  });

  it("still breaks at a line somebody inserted, which no record chains past", async () => {
    await start("first");
    await start("second");
    const file = await resolveStoreFile(options);
    const [one, two] = (await readFile(file, "utf8")).trimEnd().split("\n");
    await writeFile(file, `${one}\nnot a record\n${two}\n`);

    await expect(readSessions(options)).rejects.toThrow("corrupt JSON");
    expect((await verifyLog(options)).check.break).toMatchObject({ line: 2, kind: "corrupt" });
  });

  it("still breaks at a record somebody overwrote with garbage", async () => {
    await start("first");
    await start("second");
    const file = await resolveStoreFile(options);
    const [, two] = (await readFile(file, "utf8")).trimEnd().split("\n");
    await writeFile(file, `{"cut":\n${two}\n`);

    expect((await verifyLog(options)).check.break).toMatchObject({ line: 1, kind: "corrupt" });
  });

  it("does not take an unsigned line's prev as acknowledgement", () => {
    expect(acknowledgedTorn(TORN, JSON.stringify({ id: "y", set: {}, prev: "0" }))).toBe(false);
    expect(acknowledgedTorn('{"id":"x","set":{}}', JSON.stringify({ prev: "x", hash: "h", sig: "s" }))).toBe(false);
  });
});
