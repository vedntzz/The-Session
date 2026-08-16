import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/chain.js";
import {
  fingerprint,
  loadOrCreateKeypair,
  loadPublicKey,
  privateKeyFile,
  publicKeyFile,
  publicKeyFrom,
  signHash,
  verifyHash,
} from "../src/keys.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "session-keys-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function mode(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

describe("loadOrCreateKeypair", () => {
  it("generates an Ed25519 pair on first use", async () => {
    const keypair = await loadOrCreateKeypair(home);

    expect(keypair.key.asymmetricKeyType).toBe("ed25519");
    expect(keypair.privateKey.asymmetricKeyType).toBe("ed25519");
    expect(keypair.pem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });

  it("writes the private key readable only by its owner", async () => {
    await loadOrCreateKeypair(home);

    expect(await mode(privateKeyFile(home))).toBe(0o600);
    expect(await mode(path.dirname(privateKeyFile(home)))).toBe(0o700);
  });

  it("writes the public key beside it, and shares nothing private in it", async () => {
    await loadOrCreateKeypair(home);
    const pem = await readFile(publicKeyFile(home), "utf8");

    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(pem).not.toContain("PRIVATE");
  });

  it("reuses the key it already generated", async () => {
    const first = await loadOrCreateKeypair(home);
    const before = await readFile(privateKeyFile(home), "utf8");

    const second = await loadOrCreateKeypair(home);

    expect(second.fingerprint).toBe(first.fingerprint);
    await expect(readFile(privateKeyFile(home), "utf8")).resolves.toBe(before);
  });

  it("does not overwrite a key when two processes start at once", async () => {
    const [a, b, c] = await Promise.all([
      loadOrCreateKeypair(home),
      loadOrCreateKeypair(home),
      loadOrCreateKeypair(home),
    ]);

    expect(new Set([a?.fingerprint, b?.fingerprint, c?.fingerprint]).size).toBe(1);
  });

  it("says what to do when the key file is not a key", async () => {
    await loadOrCreateKeypair(home);
    await writeFile(privateKeyFile(home), "not a key", "utf8");

    await expect(loadOrCreateKeypair(home)).rejects.toThrow(/not a readable Ed25519 private key/);
  });
});

describe("loadPublicKey", () => {
  it("is undefined on a machine that has never signed", async () => {
    await expect(loadPublicKey(home)).resolves.toBeUndefined();
  });

  it("never generates a key of its own", async () => {
    await loadPublicKey(home);

    await expect(stat(privateKeyFile(home))).rejects.toThrow();
  });

  it("derives the public key from the private one", async () => {
    const created = await loadOrCreateKeypair(home);

    await expect(loadPublicKey(home)).resolves.toMatchObject({
      fingerprint: created.fingerprint,
    });
  });

  it("falls back to the public key alone, so a log can be checked elsewhere", async () => {
    const created = await loadOrCreateKeypair(home);
    await rm(privateKeyFile(home));

    const loaded = await loadPublicKey(home);

    expect(loaded?.fingerprint).toBe(created.fingerprint);
    expect(loaded?.key.asymmetricKeyType).toBe("ed25519");
  });
});

describe("fingerprint", () => {
  it("names the key, and two keys differently", async () => {
    const mine = await loadOrCreateKeypair(home);
    const theirs = generateKeyPairSync("ed25519");

    expect(mine.fingerprint).toMatch(/^ed25519:[0-9a-f]{32}$/);
    expect(fingerprint(theirs.publicKey)).not.toBe(mine.fingerprint);
  });
});

describe("signHash / verifyHash", () => {
  it("round-trips a signature over a digest", async () => {
    const { privateKey, key: publicKey } = await loadOrCreateKeypair(home);
    const hash = sha256("a record");

    expect(verifyHash(hash, signHash(hash, privateKey), publicKey)).toBe(true);
  });

  it("rejects a signature over a different digest", async () => {
    const { privateKey, key: publicKey } = await loadOrCreateKeypair(home);

    const sig = signHash(sha256("a record"), privateKey);

    expect(verifyHash(sha256("another record"), sig, publicKey)).toBe(false);
  });

  it("rejects a signature from another key", async () => {
    const { key: publicKey } = await loadOrCreateKeypair(home);
    const other = generateKeyPairSync("ed25519");
    const hash = sha256("a record");

    expect(verifyHash(hash, signHash(hash, other.privateKey), publicKey)).toBe(false);
  });

  it("returns false rather than throwing on a signature that is not base64", async () => {
    const { key: publicKey } = await loadOrCreateKeypair(home);

    expect(verifyHash(sha256("x"), "!!! not base64 !!!", publicKey)).toBe(false);
    expect(verifyHash(sha256("x"), "", publicKey)).toBe(false);
  });
});

describe("publicKeyFrom", () => {
  it("reads a key file someone sent you", async () => {
    const mine = await loadOrCreateKeypair(home);

    const loaded = await publicKeyFrom(publicKeyFile(home));

    expect(loaded.fingerprint).toBe(mine.fingerprint);
    expect(loaded.source).toBe(publicKeyFile(home));
  });

  it("reads the PEM itself, for a key that arrived pasted into a message", async () => {
    const mine = await loadOrCreateKeypair(home);

    const loaded = await publicKeyFrom(`\n${mine.pem}\n`);

    expect(loaded.fingerprint).toBe(mine.fingerprint);
    expect(loaded.source).toBe("the key you passed");
  });

  it("refuses a fingerprint, which names a key without being one", async () => {
    const mine = await loadOrCreateKeypair(home);

    await expect(publicKeyFrom(mine.fingerprint)).rejects.toThrow(
      /is a fingerprint, not a key.*session key show/s,
    );
  });

  it("says where it looked when there is no key there", async () => {
    await expect(publicKeyFrom(path.join(home, "nope.pub"))).rejects.toThrow(/No public key at /);
  });

  it("refuses a private key, so one cannot be handed out by accident", async () => {
    await loadOrCreateKeypair(home);

    // Node would derive the public half from it quite happily. The point is to
    // catch whoever is about to send that file to someone.
    await expect(publicKeyFrom(privateKeyFile(home))).rejects.toThrow(/holds a private key/);
    await expect(publicKeyFrom(await readFile(privateKeyFile(home), "utf8"))).rejects.toThrow(
      /Never send that to anyone/,
    );
  });

  it("refuses a key of the wrong type", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const file = path.join(home, "rsa.pub");
    await writeFile(file, rsa.publicKey.export({ type: "spki", format: "pem" }).toString(), "utf8");

    await expect(publicKeyFrom(file)).rejects.toThrow(/is rsa, not Ed25519/);
  });
});
