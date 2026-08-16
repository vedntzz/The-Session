import { createHash } from "node:crypto";

/**
 * The hash chain that makes the log tamper-evident.
 *
 * Every line carries three fields beyond the record itself:
 *
 *   prev  SHA-256 of the whole previous line, as it sits on disk
 *   hash  SHA-256 of this record's body — everything but `hash` and `sig`
 *   sig   Ed25519 signature over the raw bytes of `hash`
 *
 * `prev` covers the previous line's own hash and signature, so the lines form
 * a chain: editing any line changes its hash, which orphans every line after
 * it. Deleting a line does the same. Appending a forged line needs the private
 * key. What none of this prevents is truncation — lopping off the tail leaves
 * a shorter but internally consistent log — which is the honest limit of a
 * single-file scheme with no witness anywhere else.
 *
 * Everything here is pure. Reading the log, and reading keys, happens above.
 */

/** The `prev` of the first line: nothing precedes it. */
export const GENESIS = "0".repeat(64);

/** Hex SHA-256, the one digest this file speaks in. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 of a line exactly as stored, without its terminating newline. */
export function lineHash(line: string): string {
  return sha256(line);
}

/**
 * JSON with object keys in sorted order, applied recursively.
 *
 * A record is hashed as a value, not as the text it happened to arrive in, so
 * that a verifier reaches the same digest after a round trip through
 * `JSON.parse`. Sorting keys means a re-serialization that reorders them —
 * which changes nothing about what the record says — still verifies.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is not JSON; JSON.stringify drops such keys, so we do too.
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(",")}}`;
}

/**
 * The part of a record its hash covers: the record proper, plus the link to
 * the line before it. `hash` and `sig` are excluded — a value cannot commit to
 * itself, and a signature is made over the hash rather than under it.
 */
export interface SignedBody {
  v: number;
  id: string;
  at: string;
  set: unknown;
  prev: string;
  /**
   * Fingerprint of the key that signed this record, so a verifier holding only
   * the log knows which key to ask for. Inside the hash, so the claim cannot be
   * changed without breaking the record.
   *
   * Absent on records written before fingerprints were embedded. Since
   * `canonicalJson` drops undefined, those records hash exactly as they always
   * did, and keep verifying.
   */
  key?: string;
}

/** The digest a record's `hash` field must equal. */
export function recordHash(body: SignedBody): string {
  return sha256(canonicalJson(body));
}
