import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatVerify,
  formatVerifyPeers,
  peersFailed,
  verifyLog,
  verifyPeers,
} from "../src/commands/verify.js";
import { loadOrCreateKeypair, loadPublicKey, publicKeyFile } from "../src/keys.js";
import { appendSession, resolveStoreFile, type StoreOptions } from "../src/store.js";
import {
  REF_PREFIX,
  LOG_ENTRY,
  fingerprintOf,
  formatPeers,
  formatPull,
  formatPush,
  linesOf,
  listPeers,
  pullPeers,
  pushLog,
  refFor,
  sortPeers,
  summarizeLog,
  type Peer,
} from "../src/sync.js";

const execFileAsync = promisify(execFile);

let root: string;
/** The shared bare repo both machines push to. */
let origin: string;
/** Two checkouts with two stores: two developers, two signing keys. */
let one: StoreOptions & { home: string; cwd: string };
let two: StoreOptions & { home: string; cwd: string };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

/** git with content on stdin, for the object-writing plumbing. */
async function gitInput(cwd: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    );
    child.stdin?.end(input);
  });
}

/** A checkout of the shared origin, with a store of its own beside it. */
async function machine(name: string): Promise<StoreOptions & { home: string; cwd: string }> {
  const cwd = path.join(root, name);
  await mkdir(cwd, { recursive: true });
  await git(cwd, "init", "-q", ".");
  await git(cwd, "config", "user.email", `${name}@example.com`);
  await git(cwd, "config", "user.name", name);
  await git(cwd, "remote", "add", "origin", origin);
  await writeFile(path.join(cwd, "a.txt"), name, "utf8");
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "--no-verify", "-m", "first");
  return { home: path.join(root, `${name}-store`), cwd };
}

/** Records a finished session, so there is something to publish. */
async function record(options: StoreOptions, intent: string): Promise<void> {
  const startedAt = new Date().toISOString();
  await appendSession(
    {
      intent,
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
      startCommit: "abc1234",
      reality: ["src/api/orders.ts"],
    },
    options,
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-sync-"));
  origin = path.join(root, "origin.git");
  await mkdir(origin, { recursive: true });
  await git(origin, "init", "-q", "--bare", ".");
  one = await machine("one");
  two = await machine("two");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ref names", () => {
  it("puts a fingerprint somewhere a ref name can hold it", () => {
    expect(refFor("ed25519:ab063b54")).toBe("refs/session/ed25519-ab063b54");
  });

  it("reads the fingerprint back out unchanged", () => {
    const fingerprint = "ed25519:ab063b54961934584ad378dcffca02e9";
    expect(fingerprintOf(refFor(fingerprint))).toBe(fingerprint);
  });

  it("ignores refs that are not ours", () => {
    expect(fingerprintOf("refs/heads/main")).toBeUndefined();
    expect(fingerprintOf("refs/session/nodash")).toBeUndefined();
  });

  it("stays out of every namespace a porcelain command reads", () => {
    expect(REF_PREFIX.startsWith("refs/heads/")).toBe(false);
    expect(REF_PREFIX.startsWith("refs/remotes/")).toBe(false);
    expect(REF_PREFIX.startsWith("refs/tags/")).toBe(false);
  });
});

describe("summarizeLog", () => {
  it("counts records and takes the newest timestamp", () => {
    const text =
      `{"id":"a","at":"2026-05-01T10:00:00.000Z"}\n` +
      `{"id":"b","at":"2026-05-03T10:00:00.000Z"}\n` +
      `{"id":"c","at":"2026-05-02T10:00:00.000Z"}\n`;

    const summary = summarizeLog(text);

    expect(summary.records).toBe(3);
    expect(summary.lastSeen).toBe("2026-05-03T10:00:00.000Z");
  });

  it("reads an empty log as empty rather than failing", () => {
    const summary = summarizeLog("");

    expect(summary.records).toBe(0);
    expect(summary.lastSeen).toBeUndefined();
  });

  it("counts blank lines in the line numbers it reports", () => {
    expect(linesOf('\n{"id":"a"}\n')[0]?.no).toBe(2);
  });
});

describe("sortPeers", () => {
  const peer = (fingerprint: string, mine: boolean, lastSeen?: string): Peer =>
    ({
      fingerprint,
      ref: refFor(fingerprint),
      commit: "abc1234",
      mine,
      summary: { records: 1, lastSeen, check: { total: 1 } },
    }) as Peer;

  it("puts this machine first, then the most recently active", () => {
    const sorted = sortPeers([
      peer("ed25519:aaa", false, "2026-05-01T00:00:00.000Z"),
      peer("ed25519:bbb", false, "2026-05-09T00:00:00.000Z"),
      peer("ed25519:ccc", true, "2026-01-01T00:00:00.000Z"),
    ]);

    expect(sorted.map((entry) => entry.fingerprint)).toEqual([
      "ed25519:ccc",
      "ed25519:bbb",
      "ed25519:aaa",
    ]);
  });
});

describe("push", () => {
  it("publishes the log to a ref of its own on origin", async () => {
    await record(one, "add rate limiting");

    const result = await pushLog(one);

    const fingerprint = (await loadOrCreateKeypair(one.home)).fingerprint;
    expect(result.fingerprint).toBe(fingerprint);
    expect(result.ref).toBe(refFor(fingerprint));
    expect(await git(origin, "for-each-ref", "--format=%(refname)", REF_PREFIX)).toBe(result.ref);
  });

  it("puts the log where anyone with the repo can read it", async () => {
    await record(one, "add rate limiting");
    const { ref } = await pushLog(one);

    const published = await git(origin, "cat-file", "-p", `${ref}:session.jsonl`);
    const local = await readFile(await resolveStoreFile(one), "utf8");

    expect(`${published}\n`).toBe(local);
  });

  it("leaves git log, git status and the branches untouched", async () => {
    const heads = ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"];
    const before = {
      log: await git(one.cwd, "log", "--oneline"),
      graph: await git(one.cwd, "log", "--oneline", "--branches", "--remotes", "--tags"),
      status: await git(one.cwd, "status", "--porcelain"),
      branches: await git(one.cwd, "branch", "-a"),
      refs: await git(one.cwd, ...heads),
    };

    await record(one, "add rate limiting");
    await pushLog(one);

    expect(await git(one.cwd, "log", "--oneline")).toBe(before.log);
    expect(await git(one.cwd, "log", "--oneline", "--branches", "--remotes", "--tags")).toBe(
      before.graph,
    );
    expect(await git(one.cwd, "status", "--porcelain")).toBe(before.status);
    expect(await git(one.cwd, "branch", "-a")).toBe(before.branches);
    expect(await git(one.cwd, ...heads)).toBe(before.refs);
  });

  it("is reachable from git log --all, which means every ref and includes ours", async () => {
    // Not a leak — it is what --all asks for, the same way it shows refs/notes
    // and refs/stash. Recorded here so the one place records are visible is a
    // decision rather than a surprise.
    await record(one, "add rate limiting");
    const { commit } = await pushLog(one);

    expect(await git(one.cwd, "log", "--oneline", "--all")).toContain(commit.slice(0, 7));
    expect(await git(one.cwd, "log", "--oneline")).not.toContain(commit.slice(0, 7));
  });

  it("carries history: each push commits on top of the last", async () => {
    await record(one, "the first thing");
    const first = await pushLog(one);
    await record(one, "the second thing");
    const second = await pushLog(one);

    expect(second.committed).toBe(true);
    expect(await git(one.cwd, "rev-parse", `${second.commit}^`)).toBe(first.commit);
    expect((await git(origin, "rev-list", "--count", second.ref)).trim()).toBe("2");
  });

  it("does not commit again when nothing has been recorded since", async () => {
    await record(one, "the only thing");
    const first = await pushLog(one);
    const again = await pushLog(one);

    expect(again.committed).toBe(false);
    expect(again.commit).toBe(first.commit);
    expect((await git(origin, "rev-list", "--count", again.ref)).trim()).toBe("1");
  });

  it("refuses a log whose chain is broken, and publishes nothing", async () => {
    await record(one, "add rate limiting");
    await record(one, "and another");

    // Edit a record in place: the hash it carries no longer matches it.
    const file = await resolveStoreFile(one);
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    const tampered = JSON.parse(lines[0] as string) as { set: { intent: string } };
    tampered.set.intent = "something else entirely";
    lines[0] = JSON.stringify(tampered);
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");

    await expect(pushLog(one)).rejects.toThrow(/does not verify.*Nothing was pushed/s);
    expect(await git(origin, "for-each-ref", "--format=%(refname)", REF_PREFIX)).toBe("");
  });

  it("refuses when there is no origin to publish to", async () => {
    await git(one.cwd, "remote", "remove", "origin");
    await record(one, "add rate limiting");

    await expect(pushLog(one)).rejects.toThrow(/No origin remote/);
  });

  it("refuses when there is nothing recorded yet", async () => {
    await expect(pushLog(one)).rejects.toThrow(/No log to push/);
  });
});

describe("pull", () => {
  it("says so when origin has never seen a session ref", async () => {
    const result = await pullPeers(one);

    expect(result.fetched).toEqual([]);
    expect(formatPull(result)).toEqual(["  pulled   nothing — origin has no session records yet"]);
  });

  it("brings down another key's records", async () => {
    await record(two, "the other developer's work");
    await pushLog(two);

    const result = await pullPeers(one);

    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;
    expect(result.fetched).toEqual([
      { fingerprint: theirs, ref: refFor(theirs), state: "new", records: 1 },
    ]);
  });

  it("does not merge anything into the local log", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);

    const before = await readFile(await resolveStoreFile(one), "utf8");
    await pullPeers(one);
    const after = await readFile(await resolveStoreFile(one), "utf8");

    // Byte for byte: a peer's chain is theirs, and this machine appends to
    // exactly one log.
    expect(after).toBe(before);
  });

  it("leaves the branches alone on the way in", async () => {
    await record(two, "the other developer's work");
    await pushLog(two);

    const before = await git(one.cwd, "branch", "-a");
    await pullPeers(one);

    expect(await git(one.cwd, "branch", "-a")).toBe(before);
    expect(await git(one.cwd, "status", "--porcelain")).toBe("");
  });

  it("reports a second key appearing beside the first", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await pullPeers(one);

    await record(two, "the other developer's work");
    await pushLog(two);
    const result = await pullPeers(one);

    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;
    const states = new Map(result.fetched.map((entry) => [entry.fingerprint, entry.state]));

    expect(states.get(mine)).toBe("unchanged");
    expect(states.get(theirs)).toBe("new");
  });

  it("reports a key that has moved on since last time", async () => {
    await record(two, "the first thing");
    await pushLog(two);
    await pullPeers(one);

    await record(two, "the second thing");
    await pushLog(two);
    const result = await pullPeers(one);

    expect(result.fetched[0]).toMatchObject({ state: "updated", records: 2 });
  });

  it("prints a row per key, with the state where it cannot run into anything", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    const lines = formatPull(await pullPeers(one));
    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;

    // Two spaces between every column, including around the widest state word.
    expect(lines.find((entry) => entry.includes(mine))).toBe(
      `  ${mine}  1 record  unchanged`,
    );
    expect(lines.at(-1)).toBe("  pulled   2 keys from origin");
  });

  it("refuses when there is no origin to pull from", async () => {
    await git(one.cwd, "remote", "remove", "origin");
    await expect(pullPeers(one)).rejects.toThrow(/No origin remote/);
  });
});

describe("peers", () => {
  it("is empty before anything has been published", async () => {
    expect(await listPeers(one)).toEqual([]);
  });

  it("lists both keys after a pull, marking this machine's own", async () => {
    await record(one, "my own work");
    await record(one, "and more of it");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    const peers = await listPeers(one);
    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;

    expect(peers).toHaveLength(2);
    expect(peers.find((peer) => peer.mine)?.fingerprint).toBe(mine);
    expect(peers.find((peer) => peer.fingerprint === theirs)?.mine).toBe(false);
  });

  it("counts each key's records and dates them from the records themselves", async () => {
    await record(one, "my own work");
    await record(one, "and more of it");
    await pushLog(one);

    const [mine] = await listPeers(one);

    // Two sessions, one creating record each.
    expect(mine?.summary.records).toBe(2);
    expect(mine?.summary.lastSeen?.slice(0, 4)).toBe(new Date().toISOString().slice(0, 4));
  });

  it("prints a row per key, this machine's first", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    const lines = formatPeers(await listPeers(one));
    const today = new Date().toISOString().slice(0, 10);

    expect(lines[0]).toContain("(this machine)");
    expect(lines[0]).toContain(`last ${today}`);
    expect(lines[1]).not.toContain("(this machine)");
    expect(lines.at(-1)).toBe("  peers    2 keys on this machine");
  });

  it("says what to run when there are no peers yet", () => {
    expect(formatPeers([])[0]).toBe("  peers    none yet");
  });

  it("names a peer whose chain does not add up", async () => {
    await record(two, "the other developer's work");
    await record(two, "and another");
    await pushLog(two);
    await pullPeers(one);

    // Rewrite the peer's log under their ref, the way someone with push access
    // to the remote could: the bytes move, and the chain stops adding up.
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;
    const ref = refFor(theirs);
    const lines = (await git(one.cwd, "cat-file", "-p", `${ref}:session.jsonl`)).split("\n");
    const first = JSON.parse(lines[0] as string) as { set: { intent: string } };
    first.set.intent = "not what they said";
    lines[0] = JSON.stringify(first);

    const blob = await gitInput(one.cwd, ["hash-object", "-w", "--stdin"], `${lines.join("\n")}\n`);
    const tree = await gitInput(one.cwd, ["mktree"], `100644 blob ${blob}\tsession.jsonl\n`);
    const commit = await git(one.cwd, "commit-tree", tree, "-m", "rewritten");
    await git(one.cwd, "update-ref", ref, commit);

    const broken = formatPeers(await listPeers(one)).find((entry) => entry.includes("broken"));

    expect(broken).toContain(theirs);
    expect(broken).toMatch(/line \d+/);
  });
});

describe("formatPush", () => {
  it("says what was verified, where it went, and what moved", async () => {
    await record(one, "add rate limiting");

    const lines = formatPush(await pushLog(one));

    expect(lines[0]).toBe("  verified 1 record, chain intact");
    expect(lines[1]).toMatch(/^ {2}ref {6}refs\/session\/ed25519-[0-9a-f]{32}$/);
    expect(lines[2]).toBe("  pushed   1 record to origin");
  });

  it("says when a push published nothing new", async () => {
    await record(one, "add rate limiting");
    await pushLog(one);

    expect(formatPush(await pushLog(one))[2]).toBe(
      "  pushed   nothing new — origin already has these 1 record",
    );
  });
});

/**
 * Publishes `text` under `ref` in `cwd`, the way a machine holding that key
 * would have. Used to put a chain in this repo that this machine did not sign.
 */
async function publishAs(cwd: string, ref: string, text: string): Promise<void> {
  const blob = await gitInput(cwd, ["hash-object", "-w", "--stdin"], text);
  const tree = await gitInput(cwd, ["mktree"], `100644 blob ${blob}\t${LOG_ENTRY}\n`);
  const commit = await git(cwd, "commit-tree", tree, "-m", "published");
  await git(cwd, "update-ref", ref, commit);
}

describe("whose chain a peer row says it is", () => {
  it("labels one this machine's only when this machine's key signed it", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    const peers = await listPeers(one);
    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;

    expect(theirs).not.toBe(mine);
    expect(peers.filter((peer) => peer.mine).map((peer) => peer.fingerprint)).toEqual([mine]);
    expect(peers.find((peer) => peer.fingerprint === theirs)?.mine).toBe(false);
    expect(formatPeers(peers).filter((row) => row.includes("(this machine)"))).toHaveLength(1);
  });

  it("does not label a second key's chain as ours because the records look like ours", async () => {
    // The same bytes this machine wrote, republished under another key's ref —
    // which is all a ref name is: a claim by whoever pushed it. Ownership is
    // the keypair in this store, not the contents of a log and not a ref name.
    await record(one, "my own work");
    await pushLog(one);
    const impostor = "ed25519:ffffffffffffffffffffffffffffffff";
    await publishAs(one.cwd, refFor(impostor), await readFile(await resolveStoreFile(one), "utf8"));

    const peers = await listPeers(one);
    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;

    expect(peers).toHaveLength(2);
    expect(peers.find((peer) => peer.fingerprint === impostor)?.mine).toBe(false);
    expect(peers.filter((peer) => peer.mine).map((peer) => peer.fingerprint)).toEqual([mine]);
  });

  it("labels nothing as ours on a machine that has no key of its own", async () => {
    await record(two, "the other developer's work");
    await pushLog(two);

    // A checkout that has never recorded anything: it can read what the team
    // published, and none of it is its own. Reading peers must not start it
    // signing, either — a key generated here would be a key nothing wrote.
    const three = await machine("three");
    await pullPeers(three);

    const peers = await listPeers(three);

    expect(peers).toHaveLength(1);
    expect(peers[0]?.mine).toBe(false);
    expect(formatPeers(peers).join("\n")).not.toContain("(this machine)");
    expect(await loadPublicKey(three.home)).toBeUndefined();
  });
});

describe("verify --peers", () => {
  it("walks every chain that was pulled, reporting each key on its own", async () => {
    await record(one, "my own work");
    await record(two, "the other developer's work");
    await pushLog(one);
    await pushLog(two);
    await pullPeers(one);

    const result = await verifyPeers(one);
    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;

    expect(result.peers.map((peer) => peer.fingerprint)).toEqual([mine, theirs]);
    expect(result.peers.every((peer) => peer.check.total === 1)).toBe(true);
    expect(peersFailed(result)).toBe(false);
  });

  it("checks our own signatures, and only the hashes of a key we do not hold", async () => {
    await record(one, "my own work");
    await record(two, "the other developer's work");
    await pushLog(one);
    await pushLog(two);
    await pullPeers(one);

    const result = await verifyPeers(one);
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;

    expect(result.peers.find((peer) => peer.mine)?.check.signaturesChecked).toBe(true);
    expect(
      result.peers.find((peer) => peer.fingerprint === theirs)?.check.signaturesChecked,
    ).toBe(false);
  });

  it("checks a peer's signatures once their key is passed", async () => {
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    const result = await verifyPeers({ ...one, key: publicKeyFile(two.home) });
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;

    const peer = result.peers.find((entry) => entry.fingerprint === theirs);
    expect(peer?.check.signaturesChecked).toBe(true);
    expect(peer?.key?.fingerprint).toBe(theirs);
    expect(peer?.check.break).toBeUndefined();
    expect(result.keyUnused).toBe(false);
  });

  it("says a key that signed none of these chains checked nothing", async () => {
    await record(one, "my own work");
    await pushLog(one);
    // A key belonging to a developer whose records are not here: it matches no
    // ref, so it checked nothing, and a report that stayed quiet about that
    // would read as though it had.
    const stranger = await machine("stranger");
    await loadOrCreateKeypair(stranger.home);

    const result = await verifyPeers({ ...one, key: publicKeyFile(stranger.home) });

    expect(result.keyUnused).toBe(true);
    expect(formatVerifyPeers(result)).toContain(
      "  key     the key you passed signed none of these chains — it checked nothing",
    );
  });

  it("fails, and names the key, when a pulled chain does not add up", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await record(two, "and another");
    await pushLog(two);
    await pullPeers(one);

    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;
    const ref = refFor(theirs);
    const lines = (await git(one.cwd, "cat-file", "-p", `${ref}:${LOG_ENTRY}`)).split("\n");
    const first = JSON.parse(lines[0] as string) as { set: { intent: string } };
    first.set.intent = "not what they said";
    lines[0] = JSON.stringify(first);
    await publishAs(one.cwd, ref, `${lines.join("\n")}\n`);

    const result = await verifyPeers(one);
    const rows = formatVerifyPeers(result);

    expect(peersFailed(result)).toBe(true);
    expect(result.peers.find((peer) => peer.mine)?.check.break).toBeUndefined();
    expect(rows.find((row) => row.startsWith("  broken"))).toContain(theirs);
    expect(rows.at(-1)).toBe("  chains  2 keys, 1 not verified");
  });

  it("fails on a published chain with no records in it", async () => {
    await publishAs(one.cwd, refFor("ed25519:0000000000000000000000000000000a"), "");

    const result = await verifyPeers(one);

    expect(result.peers[0]?.check.total).toBe(0);
    expect(peersFailed(result)).toBe(true);
    expect(formatVerifyPeers(result)[0]).toContain("no records — nothing was verified");
  });

  it("fails when nothing has been pulled: it verified nothing", async () => {
    const result = await verifyPeers(one);

    expect(result.peers).toEqual([]);
    expect(peersFailed(result)).toBe(true);
    expect(formatVerifyPeers(result)[0]).toBe(
      "  chains  none — nothing has been pulled into this repo, so nothing was checked",
    );
  });

  it("prints a row per key, this machine's first, with what each chain came to", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    const rows = formatVerifyPeers(await verifyPeers(one));
    const mine = (await loadOrCreateKeypair(one.home)).fingerprint;
    const theirs = (await loadOrCreateKeypair(two.home)).fingerprint;

    expect(rows[0]).toBe(
      `  ${mine}  intact — 1 record, hashes and signatures check out  (this machine)`,
    );
    expect(rows[1]).toBe(`  ${theirs}  intact — 1 record, hashes check out`);
    expect(rows[2]).toBe("  chains  2 keys, every chain checked");
  });

  it("is mentioned by a plain verify, so checking one log is not mistaken for all", async () => {
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "the other developer's work");
    await pushLog(two);
    await pullPeers(one);

    expect(formatVerify(await verifyLog(one)).at(-1)).toBe(
      "  peers   1 other chain in this repo went unchecked — session verify --peers walks it",
    );
  });

  it("is mentioned in the plural once a second developer's chain is here", async () => {
    const three = await machine("three");
    await record(one, "my own work");
    await pushLog(one);
    await record(two, "theirs");
    await pushLog(two);
    await record(three, "and theirs");
    await pushLog(three);
    await pullPeers(one);

    expect(formatVerify(await verifyLog(one)).at(-1)).toBe(
      "  peers   2 other chains in this repo went unchecked — session verify --peers walks them",
    );
  });

  it("says nothing about peers when the only chain here is this machine's own", async () => {
    await record(one, "my own work");
    await pushLog(one);

    const lines = formatVerify(await verifyLog(one));

    expect(lines.join("\n")).not.toContain("--peers");
    expect(lines.at(-1)).toBe("  chain   intact — 1 record, hashes and signatures check out");
  });

  it("uses no colour, no emoji, and no exclamation", async () => {
    await record(one, "my own work");
    await pushLog(one);

    for (const row of formatVerifyPeers(await verifyPeers(one))) {
      expect(row).not.toMatch(/\u001b\[/);
      expect(row).not.toMatch(/[!\p{Extended_Pictographic}]/u);
    }
  });
});
