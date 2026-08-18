import { GENESIS, lineHash, recordHash } from "./chain.js";
import { verifyHash, type PublicKey } from "./keys.js";
import type { RawLine } from "./store.js";

/**
 * Walking the chain. Pure: given the lines and a public key, this says where —
 * if anywhere — the log stops adding up. Reading the file and the key happens
 * in `commands/verify.ts`.
 */

/** What went wrong, in the order the walk can discover it. */
export type BreakKind =
  | "corrupt" // not parseable as a record at all
  | "chain" // `prev` does not name the line before it
  | "hash" // the body does not hash to the `hash` it carries
  | "key" // signed under a different key than the log claims
  | "signature" // the hash is not signed by this key
  | "unsigned"; // no hash or signature, on a log that has them elsewhere

export interface ChainBreak {
  /** 1-based line in the file. */
  line: number;
  /** The session the record belongs to, when the line parsed far enough to say. */
  id?: string;
  /** When the record was written, likewise. */
  at?: string;
  kind: BreakKind;
  /** One sentence, in the words the command prints. */
  detail: string;
}

export interface ChainCheck {
  /** Records present in the log. */
  total: number;
  /** Records checked and found sound. */
  verified: number;
  /**
   * Leading records with no hash at all: written before the log became
   * tamper-evident. They are counted, not treated as damage — there was
   * nothing to sign them with at the time.
   */
  unsigned: number;
  /** False when no public key was available, so only hashes were checked. */
  signaturesChecked: boolean;
  /**
   * The fingerprint the records claim signed them. A verifier holding nothing
   * but the log reads this to know which key to go and ask for.
   *
   * It is a claim, not a proof: a log rewritten wholesale by someone with their
   * own key would claim that key throughout and be internally consistent. What
   * it establishes is which key the log says it wants to be checked against —
   * so a reader who was told a fingerprint in advance can see they were handed
   * something else, and a key that changes partway through cannot hide.
   */
  claimedKey?: string;
  /** The first place the log stops adding up. Absent when it is intact. */
  break?: ChainBreak;
  /**
   * True when the last line has no newline on it: an append cut short. The
   * record is skipped rather than reported, matching how the log is read.
   */
  truncatedTail: boolean;
}

/** True when nothing about the log contradicts itself. */
export function isIntact(check: ChainCheck): boolean {
  return check.break === undefined;
}

/**
 * True when the walk had nothing to walk.
 *
 * Kept apart from `isIntact` because the two answer different questions, and
 * conflating them is how an evidence tool comes to pass vacuously: a log with
 * no records contradicts itself nowhere, so it is intact in the only sense
 * `isIntact` means, and reporting that as a clean bill of health would tell
 * somebody their records check out when there are no records. What a verifier
 * has to be able to say is "I checked nothing".
 */
export function isEmpty(check: ChainCheck): boolean {
  return check.total === 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Walks the log front to back and stops at the first line that does not add up.
 *
 * The order of the checks is the order in which an edit shows itself. A record
 * whose body was altered fails its own hash; the records after it then fail
 * their `prev`. Reporting the first failure therefore points at the line that
 * was touched, not at the wreckage downstream of it.
 */
export function checkChain(
  lines: readonly RawLine[],
  complete: boolean,
  publicKey?: PublicKey,
): ChainCheck {
  const check: ChainCheck = {
    total: lines.length,
    verified: 0,
    unsigned: 0,
    signaturesChecked: publicKey !== undefined,
    truncatedTail: false,
  };

  let prev = GENESIS;
  let signedSeen = false;

  for (const [index, line] of lines.entries()) {
    if (!complete && index === lines.length - 1) {
      check.truncatedTail = true;
      check.total -= 1;
      break;
    }

    const fail = (kind: BreakKind, detail: string, id?: string, at?: string): ChainCheck => {
      check.break = { line: line.no, kind, detail, ...(id ? { id } : {}), ...(at ? { at } : {}) };
      return check;
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(line.text);
    } catch {
      return fail("corrupt", "not valid JSON — the line was damaged or a write was cut short");
    }
    if (!isObject(parsed) || typeof parsed["id"] !== "string" || !isObject(parsed["set"])) {
      return fail("corrupt", "not a session record");
    }

    const id = parsed["id"];
    const at = str(parsed["at"]);
    const recordPrev = str(parsed["prev"]);
    const claimed = str(parsed["key"]);
    const hash = str(parsed["hash"]);
    const sig = str(parsed["sig"]);

    if (recordPrev === undefined && hash === undefined && sig === undefined) {
      if (signedSeen) {
        return fail(
          "unsigned",
          "carries no hash or signature, but records before it do",
          id,
          at,
        );
      }
      // Predates signing. It still links the chain: the first signed record
      // hashes it as its `prev`, so these lines cannot be edited either
      // without the break showing up at the first record that was signed.
      check.unsigned += 1;
      prev = lineHash(line.text);
      continue;
    }
    signedSeen = true;

    if (recordPrev !== prev) {
      const said = recordPrev === undefined ? "nothing" : `${recordPrev.slice(0, 12)}…`;
      return fail(
        "chain",
        `points back at ${said}, but the line before it hashes to ${prev.slice(0, 12)}… — ` +
          `a record was changed, removed, or inserted here`,
        id,
        at,
      );
    }
    if (hash === undefined || sig === undefined) {
      return fail("unsigned", "is missing its hash or its signature", id, at);
    }

    // `key` is undefined on records written before fingerprints were embedded,
    // and `canonicalJson` drops it, so those hash exactly as they always did.
    const body = {
      v: typeof parsed["v"] === "number" ? parsed["v"] : 1,
      id,
      at: at ?? "",
      set: parsed["set"],
      prev,
      ...(claimed === undefined ? {} : { key: claimed }),
    };
    if (recordHash(body) !== hash) {
      return fail("hash", "does not match the hash it carries — its contents were edited", id, at);
    }

    // The claim is inside the hash, so by here it is the fingerprint whoever
    // signed this record put there. Two things can be wrong with it, and they
    // are different accusations: the log disagrees with itself about which key
    // signed it, or it disagrees with the key the verifier was handed.
    if (claimed !== undefined) {
      if (check.claimedKey === undefined) {
        check.claimedKey = claimed;
      } else if (claimed !== check.claimedKey) {
        return fail(
          "key",
          `is signed under ${claimed}, where the records before it claim ` +
            `${check.claimedKey} — a key was replaced partway through the log`,
          id,
          at,
        );
      }
      if (publicKey && claimed !== publicKey.fingerprint) {
        return fail(
          "key",
          `claims to be signed by ${claimed}, but you are checking against ` +
            `${publicKey.fingerprint} — this log is not the one that key wrote`,
          id,
          at,
        );
      }
    }

    if (publicKey && !verifyHash(hash, sig, publicKey.key)) {
      return fail(
        "signature",
        "is not signed by this key — it was written by something else, or the key changed",
        id,
        at,
      );
    }

    check.verified += 1;
    prev = lineHash(line.text);
  }

  return check;
}
