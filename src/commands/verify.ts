import { loadPublicKey, publicKeyFile, publicKeyFrom, type PublicKey } from "../keys.js";
import { readLog, readLogFile, storeHome, type StoreOptions } from "../store.js";
import { linesOf, peerFingerprints, readPeerLogs } from "../sync.js";
import { checkChain, isEmpty, isIntact, type ChainCheck } from "../verify.js";

/** What `session verify` can be pointed at. */
export interface VerifyOptions extends StoreOptions {
  /** A log file to check instead of this repo's own. */
  log?: string;
  /** The public key to check against: a path to a key file, or the PEM itself. */
  key?: string;
  /** Check every chain pulled into this repo instead of one log. */
  peers?: boolean;
}

/** What `session verify` found, in the terms it reports them. */
export interface VerifyResult {
  /** The log that was walked. */
  file: string;
  check: ChainCheck;
  /** The key the signatures were checked against, when there was one. */
  key?: PublicKey;
  /** True when the key was named on the command line rather than found here. */
  keyGiven: boolean;
  /** Where this machine's public key is, or would be. Absent for a foreign log. */
  keyFile?: string;
  /**
   * Chains under `refs/session/*` belonging to some key other than the one
   * this log was checked against — records a `pull` brought in that this run
   * did not look at. Reported so that checking one log is not mistaken for
   * checking everything that is here. Zero outside a repo, and for a foreign
   * log, where the question is not this machine's to answer.
   */
  otherChains: number;
}

/**
 * Walks a log and checks it against a public key.
 *
 * Which log and which key are separate questions, and either can be answered
 * from outside this machine:
 *
 *   session verify                       this repo's log, this machine's key
 *   session verify --key their.pub       this repo's log, someone else's key
 *   session verify --log l --key k       neither — nothing under ~/.session is
 *                                        opened, or created, at all
 *   session verify --peers               every chain pulled from origin
 *
 * A named log with no key is checked as far as it can be: the hashes still
 * chain, and the log says which key it wants, which is exactly what the holder
 * needs to know to go and ask for it. This machine's own key is not reached for
 * in that case — a log from somewhere else has nothing to do with it, and
 * quietly checking a stranger's log against your own key would report a
 * mismatch as though it meant something.
 *
 * No key is ever generated here. Being asked to check a log is not a reason to
 * start signing on a machine that never has.
 */
export async function verifyLog(options: VerifyOptions = {}): Promise<VerifyResult> {
  const foreign = options.log !== undefined;
  const { file, lines, complete } = foreign
    ? await readLogFile(options.log as string)
    : await readLog(options);

  const key = options.key !== undefined ? await publicKeyFrom(options.key) : undefined;
  const local = key || foreign ? undefined : await loadPublicKey(storeHome(options));
  const checked = key ?? local;

  return {
    file,
    check: checkChain(lines, complete, checked),
    ...(checked ? { key: checked as PublicKey } : {}),
    keyGiven: key !== undefined,
    ...(foreign ? {} : { keyFile: publicKeyFile(storeHome(options)) }),
    otherChains: foreign ? 0 : await countOtherChains(options, checked?.fingerprint),
  };
}

/**
 * How many pulled chains belong to somebody else. A repo with none, and a
 * directory that is not a repo at all, answer the same way: there is nothing
 * else here to mention.
 */
async function countOtherChains(options: VerifyOptions, mine?: string): Promise<number> {
  try {
    return (await peerFingerprints(options)).filter((fingerprint) => fingerprint !== mine).length;
  } catch {
    return 0;
  }
}

// --- every chain that was pulled -----------------------------------------

/** One published chain, walked. */
export interface PeerVerify {
  fingerprint: string;
  ref: string;
  /** True when this is the ref this machine's own key publishes to. */
  mine: boolean;
  check: ChainCheck;
  /** The key its signatures were checked against, when one was here to check them. */
  key?: PublicKey;
}

/** What `session verify --peers` found, one entry per key. */
export interface PeersResult {
  /** Every chain under `refs/session/*`, this machine's own first. */
  peers: PeerVerify[];
  /**
   * True when a `--key` was passed that no chain here claims. It checked
   * nothing, and a report that did not say so would read as though it had.
   */
  keyUnused: boolean;
}

/**
 * Walks every chain a `pull` brought into this repo, key by key.
 *
 * Reported separately rather than summed, because they are separate claims:
 * each chain is one key's statement about its own work, and "4 of 5 keys check
 * out" is not a fact about anything. One broken peer does not make the others
 * doubtful, and the run fails on any of them.
 *
 * A key is only ever used on the chain that claims it — this machine's own
 * key on this machine's ref, a `--key` on the ref whose fingerprint matches.
 * Checking one key's signatures against another key's log would report a
 * mismatch that says nothing about either. Everything else gets its hashes
 * checked and its signatures left alone, which is the honest limit of what a
 * machine holding no peer keys can do.
 */
export async function verifyPeers(options: VerifyOptions = {}): Promise<PeersResult> {
  const given = options.key !== undefined ? await publicKeyFrom(options.key) : undefined;
  const local = await loadPublicKey(storeHome(options));

  const peers = (await readPeerLogs(options)).map((log) => {
    const key = [given, local].find((candidate) => candidate?.fingerprint === log.fingerprint);
    return {
      fingerprint: log.fingerprint,
      ref: log.ref,
      mine: local !== undefined && log.fingerprint === local.fingerprint,
      check: checkChain(linesOf(log.text), log.text === "" || log.text.endsWith("\n"), key),
      ...(key ? { key } : {}),
    };
  });

  // This machine first, for the same reason `peers` puts it first: the first
  // question anyone asks the list is whether their own records are on it.
  peers.sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1));

  return {
    peers,
    keyUnused: given !== undefined && !peers.some((peer) => peer.fingerprint === given.fingerprint),
  };
}

// --- the report ----------------------------------------------------------

const LABEL_WIDTH = 8;

function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The key line: which key was used, where it came from, what the log expected. */
function keyLine(result: VerifyResult): string {
  const claimed = result.check.claimedKey;

  if (!result.key) {
    const where = result.keyFile ? ` — none at ${result.keyFile}` : "";
    return line("key", `not checked${where}. Pass --key to check the signatures.`);
  }

  const from = result.keyGiven ? ` from ${result.key.source}` : "";
  const against =
    claimed === undefined ? "" : claimed === result.key.fingerprint ? ", as the log claims" : "";
  return line("key", `${result.key.fingerprint}${from}${against}`);
}

/** How a walk came out, in one clause, for whichever report is printing it. */
function verdict(check: ChainCheck): string {
  if (isEmpty(check)) {
    return "no records — nothing was verified";
  }
  const broken = check.break;
  if (broken) {
    return `broken at line ${broken.line} — ${plural(check.verified, "record", "records")} verified before it`;
  }
  const what = check.signaturesChecked ? "hashes and signatures check out" : "hashes check out";
  return `intact — ${plural(check.verified, "record", "records")}, ${what}`;
}

/**
 * What the command prints. An intact log gets a few lines and no adjectives; a
 * broken one names the line, says what is wrong with it, and says how much of
 * the log was sound before it — everything after a break is unproven, not
 * proven bad, and the report should not blur the two.
 *
 * A log with no records in it gets neither. There is nothing to hold a key
 * against and nothing that checked out, so the key line is dropped rather than
 * printed over an empty file: `verify` on an empty log has to read as the
 * absence of evidence it is, not as a pass.
 */
export function formatVerify(result: VerifyResult): string[] {
  const { check } = result;
  const out: string[] = [line("log", `${plural(check.total, "record", "records")}  ${result.file}`)];

  if (isEmpty(check)) {
    // The next step, but only for a log this machine is meant to be writing:
    // a file handed over from elsewhere is empty for reasons nobody here can
    // do anything about.
    const next = result.keyFile ? " Run session start to record one." : "";
    out.push(line("chain", `${verdict(check)}.${next}`));
    if (check.truncatedTail) {
      out.push(line("tail", "the only line in the file was cut short mid-write"));
    }
    if (result.otherChains > 0) {
      out.push(otherChainsLine(result.otherChains));
    }
    return out;
  }

  out.push(keyLine(result));

  // Worth saying whenever it is not already on the key line: it is the one
  // thing a holder of the log alone can act on.
  if (check.claimedKey && check.claimedKey !== result.key?.fingerprint) {
    out.push(line("claims", `${check.claimedKey} signed it — the key to ask for`));
  }

  if (check.unsigned > 0) {
    const predate = check.unsigned === 1 ? "predates" : "predate";
    out.push(
      line(
        "older",
        `${plural(check.unsigned, "record", "records")} ${predate} signing, hashed only`,
      ),
    );
  }

  const broken = check.break;
  if (!broken) {
    out.push(line("chain", verdict(check)));
  } else {
    out.push(line("broken", `line ${broken.line} ${broken.detail}`));
    if (broken.id) {
      out.push(line("record", `${broken.id.slice(0, 8)}${broken.at ? `  ${broken.at}` : ""}`));
    }
    out.push(
      line("chain", `${plural(check.verified, "record", "records")} verified before the break`),
    );
  }

  if (check.truncatedTail) {
    out.push(line("tail", "the last line was cut short mid-write and was not checked"));
  }

  if (result.otherChains > 0) {
    out.push(otherChainsLine(result.otherChains));
  }

  return out;
}

/** Said at the end of a single-log report: this run did not look at these. */
function otherChainsLine(count: number): string {
  return line(
    "peers",
    `${plural(count, "other chain", "other chains")} in this repo went unchecked — ` +
      `session verify --peers walks ${count === 1 ? "it" : "them"}`,
  );
}

/**
 * One row per key, then a line saying how many stood up.
 *
 * Each chain is reported on its own terms because each is a separate claim by
 * a separate key. There is deliberately no aggregate verdict beyond the count:
 * "the peers verify" is not a thing anyone can say, and a summary line that
 * implied it would be the vacuous pass this command exists to avoid.
 */
export function formatVerifyPeers(result: PeersResult): string[] {
  if (result.peers.length === 0) {
    return [
      line("chains", "none — nothing has been pulled into this repo, so nothing was checked"),
      line("", "session pull brings everyone else's; session push publishes yours"),
    ];
  }

  // One row per key: the fingerprint the row is about, then how its chain came
  // out. `verdict` carries the count, and distinguishes the two kinds of pass
  // — a chain whose key is not on this machine reports that its hashes check
  // out and says nothing about signatures, which is exactly what happened to
  // it.
  const out = result.peers.map(
    (peer) =>
      `  ${peer.fingerprint}  ${verdict(peer.check)}${peer.mine ? "  (this machine)" : ""}`,
  );

  // The detail sits under the rows rather than in them: a row is a line, and a
  // chain break needs a sentence.
  for (const peer of result.peers) {
    const broken = peer.check.break;
    if (broken) {
      out.push(line("broken", `${peer.fingerprint} — line ${broken.line} ${broken.detail}`));
    }
  }

  if (result.keyUnused) {
    out.push(
      line("key", "the key you passed signed none of these chains — it checked nothing"),
    );
  }

  const sound = result.peers.filter(
    (peer) => isIntact(peer.check) && !isEmpty(peer.check),
  ).length;
  out.push(
    line(
      "chains",
      sound === result.peers.length
        ? `${plural(result.peers.length, "key", "keys")}, every chain checked`
        : `${plural(result.peers.length, "key", "keys")}, ${result.peers.length - sound} not verified`,
    ),
  );

  return out;
}

/**
 * Whether the process should exit non-zero, so scripts can gate on this.
 *
 * A log with no records in it fails. Nothing about it is broken, but nothing
 * about it was checked either, and an evidence tool that answers "verified" to
 * a file it never read anything out of is worse than one that says nothing:
 * the whole value of the exit code is that a zero means somebody checked.
 */
export function verifyFailed(result: VerifyResult): boolean {
  return !isIntact(result.check) || isEmpty(result.check);
}

/**
 * The same rule over every pulled chain: any chain that does not add up, any
 * chain with nothing in it, and no chains at all all fail. `--peers` was asked
 * to check something; if it checked nothing, it did not pass.
 */
export function peersFailed(result: PeersResult): boolean {
  return (
    result.peers.length === 0 ||
    result.peers.some((peer) => !isIntact(peer.check) || isEmpty(peer.check))
  );
}
