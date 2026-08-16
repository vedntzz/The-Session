import { loadPublicKey, publicKeyFile, publicKeyFrom, type PublicKey } from "../keys.js";
import { readLog, readLogFile, storeHome, type StoreOptions } from "../store.js";
import { checkChain, isIntact, type ChainCheck } from "../verify.js";

/** What `session verify` can be pointed at. */
export interface VerifyOptions extends StoreOptions {
  /** A log file to check instead of this repo's own. */
  log?: string;
  /** The public key to check against: a path to a key file, or the PEM itself. */
  key?: string;
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

  return {
    file,
    check: checkChain(lines, complete, key ?? local),
    ...(key ?? local ? { key: (key ?? local) as PublicKey } : {}),
    keyGiven: key !== undefined,
    ...(foreign ? {} : { keyFile: publicKeyFile(storeHome(options)) }),
  };
}

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

/**
 * What the command prints. An intact log gets a few lines and no adjectives; a
 * broken one names the line, says what is wrong with it, and says how much of
 * the log was sound before it — everything after a break is unproven, not
 * proven bad, and the report should not blur the two.
 */
export function formatVerify(result: VerifyResult): string[] {
  const { check } = result;
  const out: string[] = [line("log", `${plural(check.total, "record", "records")}  ${result.file}`)];

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
    const what = check.signaturesChecked ? "hashes and signatures check out" : "hashes check out";
    out.push(line("chain", `intact — ${plural(check.verified, "record", "records")}, ${what}`));
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

  return out;
}

/** Whether the process should exit non-zero, so scripts can gate on this. */
export function verifyFailed(result: VerifyResult): boolean {
  return !isIntact(result.check);
}
