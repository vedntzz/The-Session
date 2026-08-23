import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The signing key that makes an entry in the log attributable.
 *
 * Ed25519, generated on this machine on first write and kept at
 * `<store>/keys/`. The private key never leaves that file: nothing here reads
 * it except to sign a hash, and nothing sends it anywhere — there is nowhere
 * to send it to. The public half exists to be handed out.
 *
 * This is tamper-evidence, not access control. Anyone who can read the key
 * file can sign whatever they like; what a signature establishes is that the
 * log was not edited by anything that could not.
 *
 * Callers pass the store root explicitly — `store.ts` owns the question of
 * where that is.
 */

const PRIVATE_KEY_FILE = "ed25519.key";
const PUBLIC_KEY_FILE = "ed25519.pub";

/** A key that can verify. All a verifier ever needs, and all they ever get. */
export interface PublicKey {
  key: KeyObject;
  /** SPKI PEM — the form to hand to someone who wants to check the log. */
  pem: string;
  /** Short, comparable name for the key. */
  fingerprint: string;
  /** Where it came from, in the words the report uses. */
  source: string;
}

/** A key that can sign. Only ever the one on this machine. */
export interface Keypair extends PublicKey {
  privateKey: KeyObject;
}

function keysDir(home: string): string {
  return path.join(home, "keys");
}

/** Absolute path of the private key, for messages that need to name it. */
export function privateKeyFile(home: string): string {
  return path.join(keysDir(home), PRIVATE_KEY_FILE);
}

/** Absolute path of the public key. */
export function publicKeyFile(home: string): string {
  return path.join(keysDir(home), PUBLIC_KEY_FILE);
}

/**
 * A short name for a public key, so two people can agree they are talking
 * about the same one without diffing PEM blocks. SHA-256 of the DER encoding,
 * which is what other tools fingerprint too.
 */
export function fingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 32)}`;
}

function pemOf(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

function describe(key: KeyObject, source: string): PublicKey {
  return { key, pem: pemOf(key), fingerprint: fingerprint(key), source };
}

function signing(privateKey: KeyObject, home: string): Keypair {
  return { ...describe(createPublicKey(privateKey), publicKeyFile(home)), privateKey };
}

async function readPem(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readPrivateKey(home: string): Promise<KeyObject | undefined> {
  const file = privateKeyFile(home);
  const pem = await readPem(file);
  if (pem === undefined) {
    return undefined;
  }

  try {
    return createPrivateKey(pem);
  } catch (error) {
    throw new Error(
      `The signing key at ${file} is not a readable Ed25519 private key. Move it ` +
        `aside to have a new one generated — records already signed stay verifiable ` +
        `only against the key that signed them.`,
      { cause: error },
    );
  }
}

async function writePublicKey(home: string, publicKey: KeyObject): Promise<void> {
  await writeFile(publicKeyFile(home), pemOf(publicKey), { encoding: "utf8", mode: 0o644 });
}

/**
 * Loads the keypair, generating one on first use. The private key is written
 * with `wx` and mode 0600: two processes starting at once cannot overwrite
 * each other, and the loser of that race reads the winner's key rather than
 * replacing it.
 */
export async function loadOrCreateKeypair(home: string): Promise<Keypair> {
  const existing = await readPrivateKey(home);
  if (existing) {
    return signing(existing, home);
  }

  await mkdir(keysDir(home), { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  const winner = await claimPrivateKey(home, privateKey);
  if (winner) {
    return signing(winner, home); // another process got there first
  }

  await writePublicKey(home, publicKey);
  return signing(privateKey, home);
}

/**
 * Writes the new key, or returns the one already there.
 *
 * `wx` is what makes this a race nobody loses badly: the process that arrives
 * second is refused the write and reads the winner's key instead of replacing
 * a key that may already have signed records.
 */
async function claimPrivateKey(home: string, privateKey: KeyObject): Promise<KeyObject | undefined> {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  try {
    await writeFile(privateKeyFile(home), pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const winner = await readPrivateKey(home);
    if (!winner) {
      throw error;
    }
    return winner;
  }
}

/**
 * The public key on this machine, without generating anything. Being asked to
 * check a log is not a reason to start signing on a machine that never has.
 * Falls back to the stored public half, so a log can still be checked where
 * the private key was never copied.
 */
export async function loadPublicKey(home: string): Promise<PublicKey | undefined> {
  const privateKey = await readPrivateKey(home);
  if (privateKey) {
    return describe(createPublicKey(privateKey), publicKeyFile(home));
  }

  const pem = await readPem(publicKeyFile(home));
  if (pem === undefined) {
    return undefined;
  }
  return describe(parsePublicKey(pem, publicKeyFile(home)), publicKeyFile(home));
}

function parsePublicKey(pem: string, source: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    throw new Error(`The public key at ${source} is not a readable Ed25519 public key.`, {
      cause: error,
    });
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `The public key at ${source} is ${key.asymmetricKeyType ?? "of an unknown type"}, ` +
        `not Ed25519. Nothing here signs with anything else.`,
    );
  }
  return key;
}

/**
 * A public key named on the command line, for checking a log that came from
 * somewhere else. Takes the path to a key file, or the PEM itself — whichever
 * form the key arrived in.
 *
 * A fingerprint is refused rather than accepted and quietly ignored: it names
 * a key, it is not one, and a check that silently verified nothing would be
 * worse than no check at all.
 */
export async function publicKeyFrom(source: string): Promise<PublicKey> {
  const given = source.trim();

  if (given.startsWith("-----BEGIN")) {
    return describe(parsePublicKey(refusePrivate(given, "the key you passed"), "the key you passed"), "the key you passed");
  }
  if (given.startsWith("ed25519:")) {
    throw new Error(
      `${given} is a fingerprint, not a key: it names a key without being one, so it ` +
        `cannot check a signature. Pass the public key file itself — the person who ` +
        `wrote the log can print it with session key show.`,
    );
  }

  const pem = await readPem(given);
  if (pem === undefined) {
    throw new Error(`No public key at ${given}. Pass the path to a key file, or the PEM itself.`);
  }
  return describe(parsePublicKey(refusePrivate(pem, given), given), given);
}

/**
 * Node will happily derive a public key from a private one, which would make
 * `--key ~/.session/keys/ed25519.key` work. It is refused anyway: whoever
 * typed that is one step from sending that file to the person who asked for a
 * key, and the tool should say so while it is still a mistake and not a leak.
 */
function refusePrivate(pem: string, source: string): string {
  if (/-----BEGIN[^-]*PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      `${source} holds a private key. Never send that to anyone — it is what signs ` +
        `your records. The public half is what a verifier needs: session key show prints it.`,
    );
  }
  return pem;
}

/** Signs a hex digest, returning a base64 signature over its raw bytes. */
export function signHash(hash: string, privateKey: KeyObject): string {
  return signBytes(null, Buffer.from(hash, "hex"), privateKey).toString("base64");
}

/** True when `sig` is this key's signature over `hash`. Never throws. */
export function verifyHash(hash: string, sig: string, publicKey: KeyObject): boolean {
  try {
    return verifyBytes(null, Buffer.from(hash, "hex"), publicKey, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
