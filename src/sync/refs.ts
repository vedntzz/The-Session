// What a ref is called, what one line of a published log says. Pure.
import type { LogRecord, RawLine } from "../store.js";
import { checkChain, type ChainCheck } from "../verify.js";

/**
 * Sharing records without a server.
 *
 * The log is already a signed, hash-chained file; what it lacks is a way to
 * reach anyone else. A git remote is the one piece of shared infrastructure a
 * team already has, already authenticates against, and already backs up — so
 * records travel as git objects on a ref of their own.
 *
 * Three things fall out of the ref layout, and they are the whole design:
 *
 * - **One ref per signing key.** `refs/session/<fingerprint>` is written only
 *   by the machine holding that key, so two developers never write the same
 *   ref and there is nothing to merge. Conflict is not resolved here; it is
 *   made impossible.
 * - **A commit per push, not a bare blob.** The log is a blob in a tree under
 *   a commit whose parent is the previous push. The ref therefore carries the
 *   history of what was published and when, and a rewrite shows up as a ref
 *   whose new tip does not descend from the old one — visible in
 *   `git log refs/session/<fingerprint>` rather than silent.
 * - **Nothing under `refs/heads`, `refs/remotes` or `refs/tags`.** `git log`,
 *   `git status`, `git branch -a` and every UI built on them are untouched.
 *   The one exception is `git log --all`, which means every ref in `refs/` and
 *   so includes these — the same way it already includes `refs/notes` and
 *   `refs/stash`. Nothing can be both pushable and invisible to a flag whose
 *   whole job is to show everything, so the ref lives where a reader would
 *   expect to find it.
 *
 * Pull fetches other keys' refs and stops there. It never merges them into the
 * local log: a chain is a statement by one key about its own work, and folding
 * two of them together would produce a file no key could stand behind. Peers
 * are read-only, and the local log stays the only thing this machine appends
 * to.
 */

// --- naming, and reading a log -------------------------------------------

/** Where records live. Deliberately outside every namespace git shows by default. */
export const REF_PREFIX = "refs/session/";

/** The single entry in the tree each commit points at. */
export const LOG_ENTRY = "session.jsonl";

/**
 * The ref a key publishes to.
 *
 * A fingerprint reads `ed25519:<hex>` and a ref name cannot contain a colon,
 * so the colon becomes a dash. Nothing else changes: the algorithm and the
 * digest both survive, and `fingerprintOf` puts it back exactly.
 */
export function refFor(fingerprint: string): string {
  return `${REF_PREFIX}${fingerprint.replace(":", "-")}`;
}

/** The fingerprint a ref belongs to, or undefined when it is not one of ours. */
export function fingerprintOf(ref: string): string | undefined {
  if (!ref.startsWith(REF_PREFIX)) {
    return undefined;
  }
  const name = ref.slice(REF_PREFIX.length);
  const dash = name.indexOf("-");
  return dash === -1 ? undefined : `${name.slice(0, dash)}:${name.slice(dash + 1)}`;
}

/**
 * The lines of a log as the chain walk wants them. The same rule `store.ts`
 * reads files by: blank lines are skipped but still counted, so a line number
 * in a report is the line number in the file.
 */
export function linesOf(text: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() !== "") {
      lines.push({ no: index + 1, text: line });
    }
  }
  return lines;
}

/** What one key's published log amounts to, read without trusting it. */
export interface LogSummary {
  records: number;
  /** When the newest record was written, from the records themselves. */
  lastSeen?: string;
  /** The hash chain, checked. Signatures are not: their key is not here. */
  check: ChainCheck;
}

/**
 * Reads a published log.
 *
 * The hashes are checked even though the signatures cannot be — a peer's
 * public key is not on this machine, and asking git to hold it would be a
 * second trust store to keep straight. What this catches is a log that
 * contradicts itself, which is worth catching before anyone quotes from it.
 */
export function summarizeLog(text: string): LogSummary {
  const lines = linesOf(text);
  const check = checkChain(lines, text === "" || text.endsWith("\n"));

  let lastSeen: string | undefined;
  for (const line of lines) {
    try {
      const at = (JSON.parse(line.text) as { at?: unknown }).at;
      if (typeof at === "string" && (lastSeen === undefined || at > lastSeen)) {
        lastSeen = at;
      }
    } catch {
      // A line that will not parse is the chain check's business, not this
      // loop's: it is already reported as a break.
    }
  }

  return { records: lines.length, ...(lastSeen === undefined ? {} : { lastSeen }), check };
}

/** One key whose records are on this machine. */
export interface Peer {
  fingerprint: string;
  ref: string;
  /** The commit the ref points at, so a reader can go and look at it. */
  commit: string;
  /** True for the key this machine signs with. */
  mine: boolean;
  summary: LogSummary;
}

/**
 * This machine first, then the most recently active. Ours leads because the
 * first question anyone asks a peer list is whether their own records are on
 * it; the rest are ordered by what they last did, which is the only ordering
 * that changes as the team works.
 */
export function sortPeers(peers: readonly Peer[]): Peer[] {
  return [...peers].sort((a, b) => {
    if (a.mine !== b.mine) {
      return a.mine ? -1 : 1;
    }
    const seen = (b.summary.lastSeen ?? "").localeCompare(a.summary.lastSeen ?? "");
    return seen !== 0 ? seen : a.fingerprint.localeCompare(b.fingerprint);
  });
}
