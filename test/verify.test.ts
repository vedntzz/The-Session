import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, GENESIS, lineHash, recordHash, sha256 } from "../src/chain.js";
import { formatVerify, verifyFailed, verifyLog } from "../src/commands/verify.js";
import { loadOrCreateKeypair, privateKeyFile, publicKeyFile, signHash } from "../src/keys.js";
import {
  appendSession,
  resolveStoreFile,
  updateSession,
  type NewSession,
  type StoreOptions,
} from "../src/store.js";

let root: string;
let home: string;
let cwd: string;
let options: StoreOptions;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-verify-"));
  home = path.join(root, "store");
  cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  options = { home, cwd };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T = {
  start: "2026-08-15T09:00:00.000Z",
  end: "2026-08-15T11:30:00.000Z",
  later: "2026-08-15T14:00:00.000Z",
};
const HEAD = "cdd3b4f0000000000000000000000000000000ab";

function started(intent: string, startedAt = T.start): NewSession {
  return { startedAt, intent, startCommit: HEAD };
}

/** A log with three records: two sessions, one of which was later closed. */
async function threeRecords(): Promise<void> {
  const first = await appendSession(started("fix the parser"), options);
  await appendSession(started("extract the store", T.later), options);
  await updateSession(first.id, { endedAt: T.end, reality: ["src/parse.ts"] }, options);
}

async function logLines(): Promise<string[]> {
  const text = await readFile(await resolveStoreFile(options), "utf8");
  return text.split("\n").filter((line) => line !== "");
}

async function writeLines(lines: string[], trailingNewline = true): Promise<void> {
  const file = await resolveStoreFile(options);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.join("\n") + (trailingNewline ? "\n" : ""), "utf8");
}

describe("an untouched log", () => {
  it("confirms every record", async () => {
    await threeRecords();

    const result = await verifyLog(options);

    expect(result.check.break).toBeUndefined();
    expect(result.check.total).toBe(3);
    expect(result.check.verified).toBe(3);
    expect(result.check.signaturesChecked).toBe(true);
    expect(verifyFailed(result)).toBe(false);
  });

  it("holds up over many appends", async () => {
    for (let index = 0; index < 12; index += 1) {
      await appendSession(started(`intent ${index}`, T.start), options);
    }

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { total: 12, verified: 12 },
    });
  });

  it("is intact when there is no log at all", async () => {
    const result = await verifyLog(options);

    expect(result.check).toMatchObject({ total: 0, verified: 0 });
  });

  it("names the key it checked against", async () => {
    await threeRecords();
    const keypair = await loadOrCreateKeypair(home);

    const result = await verifyLog(options);

    expect(result.key?.fingerprint).toBe(keypair.fingerprint);
    expect(result.keyGiven).toBe(false);
  });
});

describe("the chain on disk", () => {
  it("starts at genesis and links each line to the one before it", async () => {
    await threeRecords();
    const lines = await logLines();

    const records = lines.map((line) => JSON.parse(line));
    expect(records[0].prev).toBe(GENESIS);
    expect(records[1].prev).toBe(lineHash(lines[0]!));
    expect(records[2].prev).toBe(lineHash(lines[1]!));
  });

  it("gives every record a hash over its own body and a signature over that hash", async () => {
    await threeRecords();

    for (const line of await logLines()) {
      const { hash, sig, ...body } = JSON.parse(line);
      expect(hash).toBe(sha256(canonicalJson(body)));
      expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
  });

  it("keeps the private key out of the log", async () => {
    await threeRecords();
    const text = await readFile(await resolveStoreFile(options), "utf8");

    expect(text).not.toContain("PRIVATE");
    expect(text).not.toContain(await readFile(privateKeyFile(home), "utf8"));
  });
});

describe("a log that was edited", () => {
  it("catches a record whose contents were changed", async () => {
    await threeRecords();
    const lines = await logLines();
    const record = JSON.parse(lines[1]!);
    record.set.intent = "something I would rather have declared";
    lines[1] = JSON.stringify(record);
    await writeLines(lines);

    const result = await verifyLog(options);

    expect(result.check.break).toMatchObject({ kind: "hash", line: 2 });
    expect(result.check.verified).toBe(1);
    expect(verifyFailed(result)).toBe(true);
  });

  it("points at the edited record rather than the wreckage after it", async () => {
    await threeRecords();
    const lines = await logLines();
    const record = JSON.parse(lines[0]!);
    record.set.scope = ["src/somewhere-else.ts"];
    lines[0] = JSON.stringify(record);
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 1, kind: "hash" }, verified: 0 },
    });
  });

  it("catches a removed record", async () => {
    await threeRecords();
    const lines = await logLines();
    await writeLines([lines[0]!, lines[2]!]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "chain" }, verified: 1 },
    });
  });

  it("catches records swapped around", async () => {
    await threeRecords();
    const lines = await logLines();
    await writeLines([lines[1]!, lines[0]!, lines[2]!]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 1, kind: "chain" } },
    });
  });

  it("catches a record slipped into the middle", async () => {
    await threeRecords();
    const lines = await logLines();
    await writeLines([lines[0]!, lines[0]!, lines[1]!, lines[2]!]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "chain" }, verified: 1 },
    });
  });

  it("catches a line damaged beyond parsing", async () => {
    await threeRecords();
    const lines = await logLines();
    lines[1] = '{"id":"broken",';
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "corrupt" } },
    });
  });

  it("reports the session a broken record belongs to", async () => {
    const first = await appendSession(started("fix the parser"), options);
    const lines = await logLines();
    const record = JSON.parse(lines[0]!);
    record.set.intent = "rewritten";
    await writeLines([JSON.stringify(record)]);

    const result = await verifyLog(options);

    expect(result.check.break?.id).toBe(first.id);
    expect(result.check.break?.at).toMatch(/^\d{4}-/);
  });
});

describe("a log that was forged", () => {
  /** Rebuilds a line so the chain and the hash are right, and signs it with `key`. */
  function forge(previousLine: string | undefined, set: unknown, key: Parameters<typeof signHash>[1]): string {
    const body = {
      v: 1,
      id: "00000000-0000-4000-8000-000000000000",
      at: T.later,
      set,
      prev: previousLine === undefined ? GENESIS : lineHash(previousLine),
    };
    const hash = recordHash(body);
    return JSON.stringify({ ...body, hash, sig: signHash(hash, key) });
  }

  const fullSet = {
    repo: `path:/somewhere`,
    intent: "a session that never happened",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      turns: 0,
      emptyTurns: 0,
      apiCalls: 0,
      callsWithoutEdits: 0,
      model: "",
    },
    outcome: "open",
    startedAt: T.later,
    endedAt: null,
    startCommit: HEAD,
  };

  it("catches a record appended by someone without the key", async () => {
    await threeRecords();
    const lines = await logLines();
    const stranger = generateKeyPairSync("ed25519");
    await writeLines([...lines, forge(lines.at(-1), fullSet, stranger.privateKey)]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 4, kind: "signature" }, verified: 3 },
    });
  });

  it("catches a record rewritten and re-signed with another key", async () => {
    await threeRecords();
    const lines = await logLines();
    const stranger = generateKeyPairSync("ed25519");
    lines[2] = forge(lines[1], { endedAt: T.end, reality: [] }, stranger.privateKey);
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 3, kind: "signature" }, verified: 2 },
    });
  });

  it("catches a whole log rewritten under another key", async () => {
    await threeRecords();
    const stranger = generateKeyPairSync("ed25519");
    const line = forge(undefined, fullSet, stranger.privateKey);
    await writeLines([line]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 1, kind: "signature" }, verified: 0 },
    });
  });

  it("catches a record stripped of its hash and signature", async () => {
    await threeRecords();
    const lines = await logLines();
    const { hash, sig, prev, ...bare } = JSON.parse(lines[2]!);
    lines[2] = JSON.stringify(bare);
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 3, kind: "unsigned" }, verified: 2 },
    });
  });

  it("catches a record keeping its signature but losing its link", async () => {
    await threeRecords();
    const lines = await logLines();
    const record = JSON.parse(lines[1]!);
    delete record.prev;
    lines[1] = JSON.stringify(record);
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "chain" } },
    });
  });
});

describe("what the chain cannot see", () => {
  it("still reports intact after the tail was lopped off — the honest limit", async () => {
    await threeRecords();
    const lines = await logLines();
    await writeLines([lines[0]!]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { total: 1, verified: 1 },
    });
  });
});

describe("a log written before signing existed", () => {
  /** A record in the old shape: no prev, no hash, no sig. */
  function legacy(id: string, intent: string): string {
    return JSON.stringify({
      v: 1,
      id,
      at: T.start,
      set: { ...{ intent }, repo: "path:/legacy", scope: [], baseline: [], reality: [], drift: [], cost: {}, outcome: "open", startedAt: T.start, endedAt: null, startCommit: HEAD },
    });
  }

  it("counts its records rather than calling them damage", async () => {
    await writeLines([legacy("a", "one"), legacy("b", "two")]);

    const result = await verifyLog(options);

    expect(result.check).toMatchObject({ total: 2, unsigned: 2, verified: 0 });
    expect(verifyFailed(result)).toBe(false);
  });

  it("chains new records onto the old ones", async () => {
    await writeLines([legacy("a", "one")]);
    await appendSession(started("first signed session"), options);

    const lines = await logLines();
    expect(JSON.parse(lines[1]!).prev).toBe(lineHash(lines[0]!));
    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { total: 2, unsigned: 1, verified: 1 },
    });
  });

  it("catches an edit to an old record, at the first signed one", async () => {
    await writeLines([legacy("a", "one")]);
    await appendSession(started("first signed session"), options);

    const lines = await logLines();
    const old = JSON.parse(lines[0]!);
    old.set.intent = "rewritten history";
    await writeLines([JSON.stringify(old), lines[1]!]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "chain" } },
    });
  });

  it("catches an unsigned record appended after signing began", async () => {
    await appendSession(started("signed"), options);
    const lines = await logLines();
    await writeLines([...lines, legacy("b", "snuck in")]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "unsigned" }, verified: 1 },
    });
  });
});

describe("a write that was cut short", () => {
  it("skips the unterminated last line rather than calling the log broken", async () => {
    await threeRecords();
    const lines = await logLines();
    await writeLines([...lines, '{"v":1,"id":"half'], false);

    const result = await verifyLog(options);

    expect(result.check.truncatedTail).toBe(true);
    expect(result.check.break).toBeUndefined();
    expect(result.check.verified).toBe(3);
  });

  it("keeps the damage to its own line when the next record is appended", async () => {
    await threeRecords();
    const lines = await logLines();
    await writeLines([...lines, '{"v":1,"id":"half'], false);

    await appendSession(started("after the crash", T.later), options);

    const written = await logLines();
    expect(written[3]).toBe('{"v":1,"id":"half');
    expect(JSON.parse(written[4]!).prev).toBe(lineHash(written[3]!));
  });
});

describe("a machine with no key", () => {
  it("checks the hashes and says the signatures went unchecked", async () => {
    await threeRecords();
    await rm(privateKeyFile(home));
    await rm(publicKeyFile(home));

    const result = await verifyLog(options);

    expect(result.check).toMatchObject({ verified: 3, signaturesChecked: false });
    expect(result.key).toBeUndefined();
  });

  it("still catches an edit, since the hashes are checkable without a key", async () => {
    await threeRecords();
    await rm(privateKeyFile(home));
    await rm(publicKeyFile(home));
    const lines = await logLines();
    const record = JSON.parse(lines[1]!);
    record.set.intent = "changed";
    lines[1] = JSON.stringify(record);
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "hash" } },
    });
  });

  it("checks a log using only the public key, as a reviewer would", async () => {
    await threeRecords();
    await rm(privateKeyFile(home));

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { verified: 3, signaturesChecked: true },
    });
  });
});

describe("formatVerify", () => {
  it("says the log is intact, with the count and the key", async () => {
    await threeRecords();
    const lines = formatVerify(await verifyLog(options));

    expect(lines[0]).toMatch(/^ {2}log {5}3 records {2}\//);
    expect(lines[1]).toMatch(/^ {2}key {5}ed25519:[0-9a-f]{32}, as the log claims$/);
    expect(lines[2]).toBe("  chain   intact — 3 records, hashes and signatures check out");
  });

  it("names the line, what is wrong with it, and how much stood up", async () => {
    await threeRecords();
    const raw = await logLines();
    const record = JSON.parse(raw[1]!);
    record.set.intent = "rewritten";
    raw[1] = JSON.stringify(record);
    await writeLines(raw);

    const lines = formatVerify(await verifyLog(options));

    expect(lines.some((line) => line.startsWith("  broken  line 2 "))).toBe(true);
    expect(lines).toContain("  chain   1 record verified before the break");
  });

  it("says when signatures went unchecked", async () => {
    await threeRecords();
    await rm(privateKeyFile(home));
    await rm(publicKeyFile(home));

    const lines = formatVerify(await verifyLog(options));

    expect(lines[1]).toContain("Pass --key to check the signatures");
    expect(lines[2]).toMatch(/^ {2}claims {2}ed25519:[0-9a-f]{32} signed it — the key to ask for$/);
    expect(lines[3]).toBe("  chain   intact — 3 records, hashes check out");
  });

  it("mentions records that predate signing", async () => {
    await writeLines([JSON.stringify({ v: 1, id: "a", at: T.start, set: { intent: "old" } })]);
    await appendSession(started("new"), options);

    const lines = formatVerify(await verifyLog(options));

    expect(lines).toContain("  older   1 record predates signing, hashed only");
  });

  it("mentions a write that was cut short", async () => {
    await threeRecords();
    await writeLines([...(await logLines()), '{"v":1,"id":"half'], false);

    const lines = formatVerify(await verifyLog(options));

    expect(lines.at(-1)).toBe("  tail    the last line was cut short mid-write and was not checked");
  });

  it("uses no colour, no emoji, and no exclamation", async () => {
    await threeRecords();

    for (const line of formatVerify(await verifyLog(options))) {
      expect(line).not.toMatch(/\[/);
      expect(line).not.toMatch(/[!\p{Extended_Pictographic}]/u);
    }
  });
});

describe("the fingerprint embedded in every record", () => {
  it("names the key that signed it", async () => {
    await threeRecords();
    const keypair = await loadOrCreateKeypair(home);

    for (const line of await logLines()) {
      expect(JSON.parse(line).key).toBe(keypair.fingerprint);
    }
  });

  it("is inside the hash, so the claim cannot be swapped out", async () => {
    await threeRecords();
    const lines = await logLines();
    const record = JSON.parse(lines[1]!);
    record.key = "ed25519:0000000000000000000000000000000000";
    lines[1] = JSON.stringify(record);
    await writeLines(lines);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 2, kind: "hash" } },
    });
  });

  it("is reported, so a holder of the log alone knows which key to ask for", async () => {
    await threeRecords();
    const keypair = await loadOrCreateKeypair(home);

    const result = await verifyLog({ log: await resolveStoreFile(options) });

    expect(result.check.claimedKey).toBe(keypair.fingerprint);
    expect(result.check.signaturesChecked).toBe(false);
    expect(result.check.break).toBeUndefined();
  });

  it("catches a log signed by a key other than the one you were given", async () => {
    await threeRecords();
    const stranger = await mkdtemp(path.join(tmpdir(), "session-stranger-"));
    try {
      const theirs = await loadOrCreateKeypair(stranger);

      const result = await verifyLog({ ...options, key: publicKeyFile(stranger) });

      expect(result.check.break).toMatchObject({ line: 1, kind: "key" });
      expect(result.check.break?.detail).toContain(theirs.fingerprint);
      expect(verifyFailed(result)).toBe(true);
    } finally {
      await rm(stranger, { recursive: true, force: true });
    }
  });

  it("catches a key replaced partway through the log", async () => {
    await threeRecords();
    const kept = await logLines();

    // A second machine's key, continuing the same chain: every hash and every
    // signature is sound, and only the fingerprint gives it away.
    const stranger = await mkdtemp(path.join(tmpdir(), "session-stranger-"));
    try {
      const theirs = await loadOrCreateKeypair(stranger);
      const body = {
        v: 1,
        id: "00000000-0000-4000-8000-000000000000",
        at: T.later,
        set: { endedAt: T.end },
        prev: lineHash(kept.at(-1)!),
        key: theirs.fingerprint,
      };
      const hash = recordHash(body);
      await writeLines([...kept, JSON.stringify({ ...body, hash, sig: signHash(hash, theirs.privateKey) })]);

      // Checked with no key at all: the log contradicts itself, which is
      // visible to anyone holding it, key or no key.
      const result = await verifyLog({ log: await resolveStoreFile(options) });

      expect(result.check.break).toMatchObject({ line: 4, kind: "key" });
      expect(result.check.break?.detail).toContain("a key was replaced partway through");
      expect(result.check.verified).toBe(3);
    } finally {
      await rm(stranger, { recursive: true, force: true });
    }
  });

  it("leaves records written before fingerprints existed verifying as they did", async () => {
    // Signed under the old body shape, with no `key` field anywhere in it.
    const keypair = await loadOrCreateKeypair(home);
    const body = {
      v: 1,
      id: "11111111-0000-4000-8000-000000000000",
      at: T.start,
      set: {
        repo: "path:/old",
        intent: "signed before fingerprints",
        scope: [],
        baseline: [],
        reality: [],
        drift: [],
        cost: {},
        outcome: "open",
        startedAt: T.start,
        endedAt: null,
        startCommit: HEAD,
      },
      prev: GENESIS,
    };
    const hash = recordHash(body);
    await writeLines([JSON.stringify({ ...body, hash, sig: signHash(hash, keypair.privateKey) })]);

    const result = await verifyLog(options);

    expect(result.check).toMatchObject({ total: 1, verified: 1 });
    expect(result.check.claimedKey).toBeUndefined();
    expect(result.check.break).toBeUndefined();
  });
});

describe("verify --log and --key", () => {
  /** A log and its public key, as they would arrive from another machine. */
  async function handedOver(): Promise<{ log: string; key: string; fingerprint: string }> {
    await threeRecords();
    return {
      log: await resolveStoreFile(options),
      key: publicKeyFile(home),
      fingerprint: (await loadOrCreateKeypair(home)).fingerprint,
    };
  }

  it("verifies a log from elsewhere against the key that came with it", async () => {
    const { log, key, fingerprint } = await handedOver();

    const result = await verifyLog({ log, key });

    expect(result.check).toMatchObject({ total: 3, verified: 3, signaturesChecked: true });
    expect(result.check.break).toBeUndefined();
    expect(result.key?.fingerprint).toBe(fingerprint);
    expect(result.keyGiven).toBe(true);
  });

  it("reads nothing from ~/.session, not even to look", async () => {
    const { log, key } = await handedOver();
    // A store that does not exist and must not be created: if verify reaches
    // for a key here, this directory appears.
    const untouched = path.join(root, "no-store");

    const result = await verifyLog({ log, key, home: untouched, cwd: "/nonexistent" });

    expect(result.check.verified).toBe(3);
    await expect(stat(untouched)).rejects.toThrow(/ENOENT/);
  });

  it("takes the key as PEM text, not only as a path", async () => {
    const { log } = await handedOver();
    const pem = await readFile(publicKeyFile(home), "utf8");

    const result = await verifyLog({ log, key: pem });

    expect(result.check.verified).toBe(3);
    expect(result.key?.source).toBe("the key you passed");
  });

  it("catches an edited log from elsewhere", async () => {
    const { log, key } = await handedOver();
    const lines = await logLines();
    const record = JSON.parse(lines[1]!);
    record.set.reality = ["nothing to see here"];
    lines[1] = JSON.stringify(record);
    await writeLines(lines);

    const result = await verifyLog({ log, key });

    expect(result.check.break).toMatchObject({ line: 2, kind: "hash" });
  });

  it("checks the hashes of a log that arrived without a key", async () => {
    const { log, fingerprint } = await handedOver();

    const result = await verifyLog({ log });

    expect(result.check).toMatchObject({ verified: 3, signaturesChecked: false });
    expect(result.check.claimedKey).toBe(fingerprint);
    expect(result.key).toBeUndefined();
  });

  it("does not check a foreign log against this machine's own key", async () => {
    // Reaching for the local key here would report a stranger's perfectly good
    // log as signed by the wrong key, which says nothing about the log.
    const { log } = await handedOver();

    const result = await verifyLog({ log, home, cwd });

    expect(result.key).toBeUndefined();
    expect(result.check.break).toBeUndefined();
  });

  it("says where it looked when the log is not there", async () => {
    await expect(verifyLog({ log: path.join(root, "nowhere.jsonl") })).rejects.toThrow(
      /No log file at .*nowhere\.jsonl/,
    );
  });

  it("refuses a fingerprint in place of a key rather than checking nothing", async () => {
    const { log, fingerprint } = await handedOver();

    await expect(verifyLog({ log, key: fingerprint })).rejects.toThrow(/is a fingerprint, not a key/);
  });
});

describe("formatVerify, on a log from elsewhere", () => {
  it("names the key file it was given", async () => {
    await threeRecords();
    const log = await resolveStoreFile(options);

    const lines = formatVerify(await verifyLog({ log, key: publicKeyFile(home) }));

    expect(lines[1]).toContain(`from ${publicKeyFile(home)}`);
    expect(lines[1]).toContain("as the log claims");
  });

  it("names the key to ask for when none was given", async () => {
    await threeRecords();
    const { fingerprint } = await loadOrCreateKeypair(home);

    const lines = formatVerify(await verifyLog({ log: await resolveStoreFile(options) }));

    expect(lines[1]).toBe("  key     not checked. Pass --key to check the signatures.");
    expect(lines[2]).toBe(`  claims  ${fingerprint} signed it — the key to ask for`);
  });
});

describe("attribution is covered by the signature", () => {
  it("catches a record rebilled to another client", async () => {
    await appendSession(
      { ...started("add rate limiting"), attribution: { client: "Acme" } },
      options,
    );
    const lines = await logLines();
    const record = JSON.parse(lines[0]!);
    record.set.attribution.client = "Globex";
    await writeLines([JSON.stringify(record)]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 1, kind: "hash" } },
    });
  });

  it("catches attribution added to a record that never had any", async () => {
    await appendSession(started("add rate limiting"), options);
    const lines = await logLines();
    const record = JSON.parse(lines[0]!);
    record.set.attribution = { client: "Acme", billingCode: "INVENTED" };
    await writeLines([JSON.stringify(record)]);

    await expect(verifyLog(options)).resolves.toMatchObject({
      check: { break: { line: 1, kind: "hash" } },
    });
  });
});
