// push, pull and peers: what travels, and what refuses to.
import { readFile } from "node:fs/promises";
import { repoRoot } from "../git.js";
import { fingerprint, loadOrCreateKeypair, loadPublicKey } from "../keys.js";
import { resolveStoreFile, storeHome, type StoreOptions } from "../store.js";
import { checkChain, isIntact, type ChainCheck } from "../verify.js";
import {
  fingerprintOf,
  linesOf,
  LOG_ENTRY,
  refFor,
  REF_PREFIX,
  sortPeers,
  summarizeLog,
  type Peer,
} from "./refs.js";
import {
  commitTree,
  git,
  localRefs,
  readLogAt,
  resolveRef,
  syncingRepo,
  treeOf,
  updateRef,
  writeBlob,
  writeTree,
  type SyncOptions,
} from "./plumbing.js";

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
export async function readLogToPush(file: string): Promise<string> {
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
export function refuseBrokenChain(check: ChainCheck): void {
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
export async function publishLocally(
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
export async function pushRef(root: string, ref: string): Promise<void> {
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
export async function fetchSessionRefs(root: string): Promise<void> {
  await git(root, ["fetch", "--no-tags", "origin", `+${REF_PREFIX}*:${REF_PREFIX}*`]);
}

/** One ref as the fetch left it, or nothing where it is not one of ours. */
export async function describeFetched(
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
