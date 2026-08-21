import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { repoRoot } from "./git.js";
import { loadOrCreateKeypair, loadPublicKey } from "./keys.js";
import { resolveStoreFile, storeHome, type RawLine, type StoreOptions } from "./store.js";
import { checkChain, isIntact, type ChainCheck } from "./verify.js";

const execFileAsync = promisify(execFile);

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

// --- git plumbing --------------------------------------------------------
//
// Every git invocation in this file is below this line and nowhere else. All
// of it is plumbing: hash-object, mktree, commit-tree, update-ref, push,
// fetch, for-each-ref, cat-file. None of it touches the index, the work tree,
// or any ref a porcelain command reads, which is what makes syncing invisible
// to everything else in the repository.

/** Generous cap: a log of a few thousand records is still only megabytes. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

async function git(cwd: string, args: string[], input?: string): Promise<string> {
  try {
    const child = execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8",
    });
    if (input !== undefined) {
      child.child.stdin?.end(input);
    }
    const { stdout } = await child;
    return stdout;
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message?: string };
    const detail = (stderr ?? "").trim() || message || "unknown error";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

/** The origin remote's URL, or undefined when there is no origin. */
async function originUrl(root: string): Promise<string | undefined> {
  return (await tryGit(root, ["remote", "get-url", "origin"]))?.trim();
}

/** Writes `content` into the object database and returns its blob id. */
async function writeBlob(root: string, content: string): Promise<string> {
  // --no-filters: the log is bytes to be reproduced exactly, not a work-tree
  // file to be run through anyone's clean/smudge configuration.
  const sha = await git(root, ["hash-object", "-w", "--no-filters", "--stdin"], content);
  return sha.trim();
}

/** A tree holding the log under one well-known name. */
async function writeTree(root: string, blob: string): Promise<string> {
  const tree = await git(root, ["mktree"], `100644 blob ${blob}\t${LOG_ENTRY}\n`);
  return tree.trim();
}

async function commitTree(
  root: string,
  tree: string,
  parent: string | undefined,
  message: string,
): Promise<string> {
  const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message];
  return (await git(root, args)).trim();
}

/** The commit a ref points at, or undefined when the ref does not exist. */
async function resolveRef(root: string, ref: string): Promise<string | undefined> {
  return (await tryGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]))?.trim();
}

/** The tree a commit points at. */
async function treeOf(root: string, commit: string): Promise<string | undefined> {
  return (await tryGit(root, ["rev-parse", "--verify", "--quiet", `${commit}^{tree}`]))?.trim();
}

/**
 * Moves a ref, refusing if it is not where the caller thought it was. The old
 * value is a compare-and-swap: two `session push` runs at once cannot lose one
 * another's commit.
 */
async function updateRef(
  root: string,
  ref: string,
  commit: string,
  old: string | undefined,
): Promise<void> {
  await git(root, ["update-ref", ref, commit, ...(old === undefined ? [] : [old])]);
}

/** Every session ref on this machine, with the commit each points at. */
async function localRefs(root: string): Promise<Map<string, string>> {
  const out = await git(root, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    REF_PREFIX,
  ]);

  const refs = new Map<string, string>();
  for (const entry of out.split("\n")) {
    const [ref, sha] = entry.trim().split(" ");
    if (ref && sha) {
      refs.set(ref, sha);
    }
  }
  return refs;
}

/** The log stored under a ref, or undefined when the ref holds something else. */
async function readLogAt(root: string, ref: string): Promise<string | undefined> {
  return tryGit(root, ["cat-file", "-p", `${ref}:${LOG_ENTRY}`]);
}

// --- the operations ------------------------------------------------------

/** Everything the three commands need beyond where the store lives. */
export type SyncOptions = StoreOptions;

/** Said the same way by every command here, since the fix is the same one. */
const NO_ORIGIN =
  "No origin remote. Records travel over the one your team already shares — " +
  "add it with git remote add origin <url>.";

/** The repo root, and the origin it syncs with. Refuses early and clearly. */
async function syncingRepo(options: SyncOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();

  let root: string;
  try {
    root = await repoRoot(cwd);
  } catch (error) {
    throw new Error(`Not a git repository: ${cwd}. Records sync over a repo's remote.`, {
      cause: error,
    });
  }

  if ((await originUrl(root)) === undefined) {
    throw new Error(NO_ORIGIN);
  }
  return root;
}

/** What `session push` did. */
export interface PushResult {
  fingerprint: string;
  ref: string;
  /** The log file that was published. */
  file: string;
  records: number;
  commit: string;
  /**
   * False when the log had not changed since the last push, so no commit was
   * made. An empty commit per push would fill the ref's history with pushes
   * that published nothing.
   */
  committed: boolean;
}

/**
 * Publishes this machine's log to origin.
 *
 * The chain is checked first and a failure stops everything: a log that does
 * not add up is exactly what nobody else can check, and pushing it would put
 * this machine's name on it. The refusal is the feature.
 */
export async function pushLog(options: SyncOptions = {}): Promise<PushResult> {
  const root = await syncingRepo(options);
  const file = await resolveStoreFile(options);
  const text = await readLogToPush(file);

  const summary = summarizeLog(text);
  refuseBrokenChain(summary.check);

  const keypair = await loadOrCreateKeypair(storeHome(options));
  const ref = refFor(keypair.fingerprint);
  const published = await publishLocally(root, ref, text, summary.records);
  await pushRef(root, ref);

  return {
    fingerprint: keypair.fingerprint,
    ref,
    file,
    records: summary.records,
    ...published,
  };
}

/** The log this machine would publish, or why there is nothing to publish. */
async function readLogToPush(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new Error(
      `No log to push for this repo (${file}). Run session start to record something first.`,
      { cause: error },
    );
  }
}

/** Stops a push that would publish a chain that does not add up. */
function refuseBrokenChain(check: ChainCheck): void {
  if (isIntact(check)) {
    return;
  }
  const { line, detail } = check.break as NonNullable<ChainCheck["break"]>;
  throw new Error(
    `The log does not verify: line ${line} ${detail}. Nothing was pushed — ` +
      `run session verify. A chain you cannot stand behind is not one to publish.`,
  );
}

/**
 * Writes the log into the ref's history on this machine.
 *
 * Nothing is committed where the ref already points at these exact bytes: an
 * empty commit per push would fill that history with pushes that published
 * nothing.
 */
async function publishLocally(
  root: string,
  ref: string,
  text: string,
  records: number,
): Promise<{ commit: string; committed: boolean }> {
  const parent = await resolveRef(root, ref);
  const blob = await writeBlob(root, text);
  const tree = await writeTree(root, blob);

  const unchanged = parent !== undefined && (await treeOf(root, parent)) === tree;
  if (unchanged) {
    return { commit: parent as string, committed: false };
  }
  const commit = await commitTree(root, tree, parent, `session log — ${records} records`);
  await updateRef(root, ref, commit, parent);
  return { commit, committed: true };
}

/**
 * Puts the ref on origin. Pushed even where nothing was committed, since the
 * local ref can be ahead of origin.
 */
async function pushRef(root: string, ref: string): Promise<void> {
  try {
    await git(root, ["push", "origin", `${ref}:${ref}`]);
  } catch (error) {
    // The one rejection worth translating: another machine holding this key
    // published something this one has never seen.
    const detail = (error as Error).message;
    if (/non-fast-forward|fetch first|rejected/i.test(detail)) {
      throw new Error(
        `origin has records under this key that this machine does not (${ref}). ` +
          `Another machine signing with the same key pushed them. Nothing was ` +
          `pushed; the two logs have to be reconciled by hand.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/** One key's ref as `session pull` found it. */
export interface Fetched {
  fingerprint: string;
  ref: string;
  /** New to this machine, moved on since last time, or exactly as it was. */
  state: "new" | "updated" | "unchanged";
  records: number;
}

export interface PullResult {
  /** Every session ref origin had, after the fetch. */
  fetched: Fetched[];
}

/**
 * Fetches every key's records from origin.
 *
 * Refs land under the same names they have on the remote rather than under
 * `refs/remotes/`: they are not branches anybody tracks, and a remote-tracking
 * copy would put them in the one namespace `git branch -a` prints. Nothing is
 * merged, and the local log is not touched — this only ever adds other
 * people's chains beside it.
 */
export async function pullPeers(options: SyncOptions = {}): Promise<PullResult> {
  const root = await syncingRepo(options);
  const before = await localRefs(root);
  await fetchSessionRefs(root);
  const after = await localRefs(root);

  const fetched: Fetched[] = [];
  for (const [ref, sha] of after) {
    const one = await describeFetched(root, ref, sha, before);
    if (one) {
      fetched.push(one);
    }
  }

  return { fetched: fetched.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)) };
}

/**
 * `--no-tags` because a tag arriving as a side effect would show up in a
 * namespace this feature promised to stay out of. A remote that has never seen
 * these refs matches nothing and succeeds quietly, which is the right answer to
 * "what has everyone else recorded" before anyone has recorded anything.
 */
async function fetchSessionRefs(root: string): Promise<void> {
  await git(root, ["fetch", "--no-tags", "origin", `+${REF_PREFIX}*:${REF_PREFIX}*`]);
}

/** One ref as the fetch left it, or nothing where it is not one of ours. */
async function describeFetched(
  root: string,
  ref: string,
  sha: string,
  before: ReadonlyMap<string, string>,
): Promise<Fetched | undefined> {
  const fingerprint = fingerprintOf(ref);
  if (fingerprint === undefined) {
    return undefined; // not a ref this tool wrote; leave it alone
  }
  const was = before.get(ref);
  const text = (await readLogAt(root, ref)) ?? "";
  return {
    fingerprint,
    ref,
    state: was === undefined ? "new" : was === sha ? "unchanged" : "updated",
    records: linesOf(text).length,
  };
}

/** One published log as it sits on this machine, read but not yet judged. */
export interface PeerLog {
  fingerprint: string;
  ref: string;
  commit: string;
  /** The log itself, byte for byte as the ref holds it. */
  text: string;
}

/**
 * Every published log on this machine, in fingerprint order.
 *
 * Deliberately says nothing about whose they are or whether they add up:
 * `listPeers` folds in ownership and a summary, `session verify --peers` walks
 * the chains against keys instead, and neither wants the other's answer.
 */
export async function readPeerLogs(options: SyncOptions = {}): Promise<PeerLog[]> {
  const cwd = options.cwd ?? process.cwd();
  const root = await repoRoot(cwd);

  const logs: PeerLog[] = [];
  for (const [ref, commit] of await localRefs(root)) {
    const fingerprint = fingerprintOf(ref);
    const text = fingerprint === undefined ? undefined : await readLogAt(root, ref);
    if (fingerprint === undefined || text === undefined) {
      continue; // someone else's ref, or a ref holding something that is not a log
    }
    logs.push({ fingerprint, ref, commit, text });
  }

  return logs.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

/**
 * The keys whose chains are on this machine, names only — no log is read.
 * Enough to say that other people's records are sitting here, which is all a
 * command that is doing something else needs to know.
 */
export async function peerFingerprints(options: SyncOptions = {}): Promise<string[]> {
  const root = await repoRoot(options.cwd ?? process.cwd());
  const names: string[] = [];
  for (const ref of (await localRefs(root)).keys()) {
    const fingerprint = fingerprintOf(ref);
    if (fingerprint !== undefined) {
      names.push(fingerprint);
    }
  }
  return names.sort();
}

/**
 * Every key whose records are on this machine, this one included once it has
 * pushed. Reads local refs only: `peers` reports what is here, and what is
 * here is whatever the last `pull` brought.
 *
 * `mine` is decided against this machine's actual keypair and nothing else — a
 * ref name is a claim by whoever pushed it, and a row labelled `(this machine)`
 * has to mean the key in `~/.session/keys` signed it. The key is read, never
 * generated: being asked who else is out there is not a reason to start
 * signing on a machine that never has. Where there is no key here, no chain is
 * ours, which is the truth — nothing on this machine could have written one.
 */
export async function listPeers(options: SyncOptions = {}): Promise<Peer[]> {
  const mine = (await loadPublicKey(storeHome(options)))?.fingerprint;

  return sortPeers(
    (await readPeerLogs(options)).map((log) => ({
      fingerprint: log.fingerprint,
      ref: log.ref,
      commit: log.commit,
      mine: mine !== undefined && log.fingerprint === mine,
      summary: summarizeLog(log.text),
    })),
  );
}

// --- the views -----------------------------------------------------------

const LABEL_WIDTH = 9;

function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The date part of a timestamp — the day is the resolution anyone reads here. */
function day(iso: string | undefined): string {
  return iso === undefined ? "never" : iso.slice(0, 10);
}

export function formatPush(result: PushResult): string[] {
  return [
    line("verified", `${plural(result.records, "record", "records")}, chain intact`),
    line("ref", result.ref),
    line(
      "pushed",
      result.committed
        ? `${plural(result.records, "record", "records")} to origin`
        : `nothing new — origin already has these ${plural(result.records, "record", "records")}`,
    ),
  ];
}

/**
 * One row per key, laid out the way `peers` lays them out: the fingerprint is
 * what the row is about, and everything else trails it. The state is a word at
 * the end rather than a label at the front — `unchanged` is exactly as wide as
 * the label column, and a label that touches its own value is unreadable.
 */
function keyRows(rows: readonly { fingerprint: string; records: number }[]): string[] {
  const counts = rows.map((row) => plural(row.records, "record", "records"));
  const width = counts.reduce((widest, count) => Math.max(widest, count.length), 0);
  return rows.map((row, index) => `  ${row.fingerprint}  ${(counts[index] as string).padStart(width)}`);
}

export function formatPull(result: PullResult): string[] {
  if (result.fetched.length === 0) {
    return [line("pulled", "nothing — origin has no session records yet")];
  }

  const lines = keyRows(result.fetched).map(
    (row, index) => `${row}  ${(result.fetched[index] as Fetched).state}`,
  );
  lines.push(line("pulled", `${plural(result.fetched.length, "key", "keys")} from origin`));
  return lines;
}

export function formatPeers(peers: readonly Peer[]): string[] {
  if (peers.length === 0) {
    return [
      line("peers", "none yet"),
      line("", "session push publishes yours; session pull brings everyone else's"),
    ];
  }

  const lines = keyRows(peers.map((peer) => ({ ...peer, records: peer.summary.records }))).map(
    (row, index) => {
      const peer = peers[index] as Peer;
      return `${row}  last ${day(peer.summary.lastSeen)}${peer.mine ? "  (this machine)" : ""}`;
    },
  );

  // Only ever said about a peer, and only when it is true: this machine's own
  // log cannot get here broken, since push refuses to publish one.
  for (const peer of peers) {
    if (!isIntact(peer.summary.check)) {
      const { line: at, detail } = peer.summary.check.break as NonNullable<ChainCheck["break"]>;
      lines.push(line("broken", `${peer.fingerprint} — line ${at} ${detail}`));
    }
  }

  lines.push(line("peers", `${plural(peers.length, "key", "keys")} on this machine`));
  return lines;
}
