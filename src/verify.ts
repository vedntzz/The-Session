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
  const check = emptyCheck(lines.length, publicKey);
  const walk: Walk = { prev: GENESIS, signedSeen: false };

  for (const [index, line] of lines.entries()) {
    if (!complete && index === lines.length - 1) {
      // An append cut short. The record is skipped rather than reported,
      // matching how the log is read.
      check.truncatedTail = true;
      check.total -= 1;
      break;
    }
    const found = checkRecord(line, walk, check, publicKey);
    if (found) {
      check.break = { line: line.no, ...found };
      return check;
    }
  }

  return check;
}

/** A walk that has read nothing yet, which is what an empty log stays at. */
function emptyCheck(total: number, publicKey?: PublicKey): ChainCheck {
  return {
    total,
    verified: 0,
    unsigned: 0,
    signaturesChecked: publicKey !== undefined,
    truncatedTail: false,
  };
}

/** What the walk carries from one line to the next. */
interface Walk {
  /** Hash of the line before this one, which this one's `prev` must name. */
  prev: string;
  /** True once a record carrying a hash has gone past. */
  signedSeen: boolean;
}

/** A break, before the walk attaches the line number it was found on. */
type Fault = Omit<ChainBreak, "line">;

function fault(kind: BreakKind, detail: string, id?: string, at?: string): Fault {
  return { kind, detail, ...(id ? { id } : {}), ...(at ? { at } : {}) };
}

/** The fields of a record the walk reads, once the line has parsed. */
interface RecordFields {
  v: number;
  id: string;
  at?: string;
  set: unknown;
  prev?: string;
  key?: string;
  hash?: string;
  sig?: string;
}

/** Ordered so the first thing reported is the first thing an edit breaks. */
function firstFault(
  fields: RecordFields,
  walk: Walk,
  check: ChainCheck,
  publicKey?: PublicKey,
): Fault | undefined {
  return (
    checkLink(fields, walk.prev) ??
    checkSigned(fields) ??
    checkBody(fields, walk.prev) ??
    checkKeyClaim(fields, check, publicKey) ??
    checkSignature(fields, publicKey)
  );
}

/**
 * Checks one record, in the order in which an edit shows itself, and advances
 * the walk past it when it holds up.
 */
function checkRecord(
  line: RawLine,
  walk: Walk,
  check: ChainCheck,
  publicKey?: PublicKey,
): Fault | undefined {
  const read = readRecord(line.text);
  if ("fault" in read) {
    return read.fault;
  }
  const fields = read.fields;

  if (predatesSigning(fields)) {
    return countUnsigned(fields, line.text, walk, check);
  }
  walk.signedSeen = true;

  const broken = firstFault(fields, walk, check, publicKey);
  if (broken) {
    return broken;
  }

  check.verified += 1;
  walk.prev = lineHash(line.text);
  return undefined;
}

/** Reads one line into the fields the walk needs, or says why it cannot. */
function readRecord(text: string): { fields: RecordFields } | { fault: Fault } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const detail = "not valid JSON — the line was damaged or a write was cut short";
    return { fault: fault("corrupt", detail) };
  }
  if (!isObject(parsed) || typeof parsed["id"] !== "string" || !isObject(parsed["set"])) {
    return { fault: fault("corrupt", "not a session record") };
  }
  return { fields: fieldsOf(parsed) };
}

/** Missing fields read as empty, which is what a pre-signing record has. */
function fieldsOf(parsed: Record<string, unknown>): RecordFields {
  return {
    v: typeof parsed["v"] === "number" ? parsed["v"] : 1,
    id: parsed["id"] as string,
    at: str(parsed["at"]),
    set: parsed["set"] as Record<string, unknown>,
    prev: str(parsed["prev"]),
    key: str(parsed["key"]),
    hash: str(parsed["hash"]),
    sig: str(parsed["sig"]),
  };
}

/** True of a record written before the log became tamper-evident. */
function predatesSigning(fields: RecordFields): boolean {
  return fields.prev === undefined && fields.hash === undefined && fields.sig === undefined;
}

/**
 * Counts a record from before signing, and links it into the chain.
 *
 * It still links: the first signed record hashes it as its `prev`, so these
 * lines cannot be edited either without the break showing up at the first
 * record that was signed. An unsigned line *after* something signed is a
 * different thing, and is damage.
 */
function countUnsigned(
  fields: RecordFields,
  text: string,
  walk: Walk,
  check: ChainCheck,
): Fault | undefined {
  if (walk.signedSeen) {
    const detail = "carries no hash or signature, but records before it do";
    return fault("unsigned", detail, fields.id, fields.at);
  }
  check.unsigned += 1;
  walk.prev = lineHash(text);
  return undefined;
}

/** `prev` must name the line before it, or a record was moved, cut or added. */
function checkLink(fields: RecordFields, prev: string): Fault | undefined {
  if (fields.prev === prev) {
    return undefined;
  }
  const said = fields.prev === undefined ? "nothing" : `${fields.prev.slice(0, 12)}…`;
  return fault(
    "chain",
    `points back at ${said}, but the line before it hashes to ${prev.slice(0, 12)}… — ` +
      `a record was changed, removed, or inserted here`,
    fields.id,
    fields.at,
  );
}

/** A record past the unsigned era must carry both a hash and a signature. */
function checkSigned(fields: RecordFields): Fault | undefined {
  if (fields.hash !== undefined && fields.sig !== undefined) {
    return undefined;
  }
  return fault("unsigned", "is missing its hash or its signature", fields.id, fields.at);
}

/** The body must hash to the `hash` the record carries. */
function checkBody(fields: RecordFields, prev: string): Fault | undefined {
  // `key` is undefined on records written before fingerprints were embedded,
  // and `canonicalJson` drops it, so those hash exactly as they always did.
  const body = {
    v: fields.v,
    id: fields.id,
    at: fields.at ?? "",
    set: fields.set,
    prev,
    ...(fields.key === undefined ? {} : { key: fields.key }),
  };
  if (recordHash(body) === fields.hash) {
    return undefined;
  }
  const detail = "does not match the hash it carries — its contents were edited";
  return fault("hash", detail, fields.id, fields.at);
}

/**
 * The fingerprint the record claims, against the log's own and against the
 * verifier's.
 *
 * The claim is inside the hash, so by here it is the fingerprint whoever signed
 * this record put there. Two things can be wrong with it, and they are
 * different accusations: the log disagrees with itself about which key signed
 * it, or it disagrees with the key the verifier was handed.
 */
function checkKeyClaim(
  fields: RecordFields,
  check: ChainCheck,
  publicKey?: PublicKey,
): Fault | undefined {
  const claimed = fields.key;
  if (claimed === undefined) {
    return undefined;
  }
  return againstTheLog(claimed, fields, check) ?? againstTheKey(claimed, fields, publicKey);
}

/** The log must not disagree with itself about which key signed it. */
function againstTheLog(claimed: string, fields: RecordFields, check: ChainCheck): Fault | undefined {
  if (check.claimedKey === undefined) {
    check.claimedKey = claimed;
    return undefined;
  }
  if (claimed === check.claimedKey) {
    return undefined;
  }
  return fault(
    "key",
    `is signed under ${claimed}, where the records before it claim ` +
      `${check.claimedKey} — a key was replaced partway through the log`,
    fields.id,
    fields.at,
  );
}

/** ...and it must not disagree with the key the verifier was handed. */
function againstTheKey(
  claimed: string,
  fields: RecordFields,
  publicKey?: PublicKey,
): Fault | undefined {
  if (!publicKey || claimed === publicKey.fingerprint) {
    return undefined;
  }
  return fault(
    "key",
    `claims to be signed by ${claimed}, but you are checking against ` +
      `${publicKey.fingerprint} — this log is not the one that key wrote`,
    fields.id,
    fields.at,
  );
}

/** The signature over the hash. Skipped when no key was available. */
function checkSignature(fields: RecordFields, publicKey?: PublicKey): Fault | undefined {
  const { hash, sig } = fields;
  // `checkSigned` has already refused a record missing either of these, so
  // neither is undefined by the time this runs.
  if (!publicKey || hash === undefined || sig === undefined) {
    return undefined;
  }
  if (verifyHash(hash, sig, publicKey.key)) {
    return undefined;
  }
  const detail = "is not signed by this key — it was written by something else, or the key changed";
  return fault("signature", detail, fields.id, fields.at);
}
