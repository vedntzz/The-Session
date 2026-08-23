// Reads the transcripts already on disk and reports what they cost. The
// side-effecting half of `scan`; the arithmetic is in `../scan.ts`.
//
// Read-only, and deliberately so. This command is the one thing in the tool
// that runs before anybody has adopted it — no `session start`, no hook, no
// `~/.session`, no record of anything. It opens transcripts, asks git
// questions, and writes nothing anywhere.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  defaultTranscriptRoot,
  transcriptsTouchedIn,
} from "../capture/adapters/claude-code.js";
import {
  costOfCalls,
  isUserAuthored,
  parseTranscriptLine,
  promptTextOf,
  recordCall,
  type Call,
} from "../capture/transcript.js";
import { isRepo, landingsSince, repoRoot, type Landing } from "../git.js";
import { summarizeScan, UNKNOWN_REPO, type ScanReport, type ScannedSession } from "../scan.js";
import type { RateTable } from "../pricing.js";

/** How far back `scan` looks when nobody says. */
export const DEFAULT_SCAN_DAYS = 30;

export interface ScanOptions {
  /** Transcript root. Defaults to `~/.claude/projects`. */
  root?: string;
  /** Only sessions that ran in this checkout. */
  repo?: string;
  /** The clock, injected so a scan of fixed transcripts is a fixed report. */
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads `--days`, which is the same question `week` asks and gets the same
 * answer: a whole number of days, at least one.
 */
export function parseScanDays(value?: string): number {
  if (value === undefined) {
    return DEFAULT_SCAN_DAYS;
  }
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--days needs a whole number of days, 1 or more. Got: ${value}`);
  }
  return days;
}

/**
 * One transcript, folded.
 *
 * Turns are numbered within the file. The adapter numbers them across every
 * transcript in a window because it is building one session out of all of
 * them; here each transcript *is* a session, so the numbering restarts and
 * the counts come out per session.
 */
interface Folded {
  calls: Map<string, Call>;
  /** The first thing the developer typed, kept for the label. */
  label?: string;
  /** Where the work ran, as the transcript reported it. */
  cwd?: string;
  first?: number;
  last?: number;
}

/**
 * Folds one transcript, a line at a time.
 *
 * Streamed rather than read: these files reach fourteen megabytes, and a scan
 * opens every one of them. `readFile` on a directory of them is a few hundred
 * megabytes of strings held at once, to answer a question that never needs
 * two lines in memory together.
 *
 * Never throws. A transcript is somebody else's file, being read by a command
 * whose whole promise is that it can be run on a machine that has never set
 * this tool up; one unreadable file reports what it can and moves on.
 */
async function foldFile(file: string, from: number, to: number): Promise<Folded> {
  const folded: Folded = { calls: new Map() };
  let turn = 0;

  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  try {
    for await (const line of lines) {
      readLine(line, folded, from, to, () => turn, (next) => (turn = next));
    }
  } catch {
    return folded; // what was read before it failed is still true
  } finally {
    stream.close();
  }
  return folded;
}

/**
 * One line, folded in.
 *
 * Turn segmentation reads every line, but only calls inside the window are
 * counted — the same rule the adapter follows, so that a turn which began
 * before the window still counts on the strength of what it did inside it.
 *
 * Lines are folded in file order rather than sorted by timestamp. The adapter
 * sorts because it merges several transcripts into one session; within a
 * single file the order written is the order things happened, and sorting
 * would mean holding the whole file to answer a question that needs one line.
 */

function readLine(
  line: string,
  folded: Folded,
  from: number,
  to: number,
  turn: () => number,
  setTurn: (next: number) => void,
): void {
  const parsed = parseTranscriptLine(line);
  if (parsed === undefined) {
    return;
  }
  const { at, entry } = parsed;

  if (folded.cwd === undefined && typeof entry["cwd"] === "string") {
    folded.cwd = entry["cwd"];
  }
  if (isUserAuthored(entry)) {
    openTurn(entry, folded, turn, setTurn);
    return;
  }
  if (at < from || at > to) {
    return;
  }
  if (recordCall(folded.calls, entry, turn())) {
    folded.first = Math.min(folded.first ?? at, at);
    folded.last = Math.max(folded.last ?? at, at);
  }
}

/** A prompt cuts a turn, and the first one that reads as a prompt names the session. */
function openTurn(
  entry: Record<string, unknown>,
  folded: Folded,
  turn: () => number,
  setTurn: (next: number) => void,
): void {
  setTurn(turn() + 1);
  if (folded.label === undefined) {
    folded.label = promptTextOf(entry);
  }
}

/** What a session with no prompt in it is called. */
export const NO_PROMPT = "(no prompt)";

/**
 * Every transcript in the window, read as a session.
 *
 * A transcript with no calls inside the window is dropped rather than reported
 * as a session that cost nothing: the file was touched in the window, which is
 * why it was opened, but nothing in it happened there.
 */
async function scannedSessions(
  root: string,
  from: number,
  to: number,
): Promise<ScannedSession[]> {
  const sessions: ScannedSession[] = [];

  for (const file of await transcriptsTouchedIn(root, from)) {
    const folded = await foldFile(file, from, to);
    if (folded.calls.size === 0) {
      continue;
    }
    sessions.push({
      id: path.basename(file, ".jsonl"),
      repo: folded.cwd ?? UNKNOWN_REPO,
      label: folded.label ?? NO_PROMPT,
      startedAt: new Date(folded.first ?? from).toISOString(),
      endedAt: new Date(folded.last ?? from).toISOString(),
      cost: costOfCalls([...folded.calls.values()]),
    });
  }
  return sessions;
}

/**
 * Rewrites each session's `repo` to the root of the checkout it ran in.
 *
 * Sessions run from subdirectories otherwise split one repository into several
 * rows, which is the one thing the table exists to avoid. Asked once per
 * distinct working directory rather than once per session — a scan of six
 * months is thousands of sessions across a handful of checkouts.
 */
async function groupByCheckout(sessions: ScannedSession[]): Promise<void> {
  const roots = new Map<string, string>();

  for (const session of sessions) {
    if (session.repo === UNKNOWN_REPO) {
      continue;
    }
    const known = roots.get(session.repo);
    if (known !== undefined) {
      session.repo = known;
      continue;
    }
    const root = await rootOf(session.repo);
    roots.set(session.repo, root);
    session.repo = root;
  }
}

/** The checkout a directory belongs to, or the directory itself. */
async function rootOf(dir: string): Promise<string> {
  try {
    return (await isRepo(dir)) ? await repoRoot(dir) : dir;
  } catch {
    return dir; // a directory that has since been deleted, or is not readable
  }
}

/**
 * Marks each session according to whether commits landed on the default branch
 * while it was running.
 *
 * One `git log` per repository, not per session: the window is the same for
 * all of them, and a scan of a busy month would otherwise be thousands of
 * subprocesses.
 *
 * Sessions in a checkout that cannot be asked — no git, no default branch, a
 * directory that has since been deleted — are left unmarked rather than marked
 * false. Not knowing where work went is not the same as knowing it went
 * nowhere, and this command has no diff to settle the question with.
 */
async function markLandings(sessions: readonly ScannedSession[], since: Date): Promise<void> {
  const byRepo = new Map<string, Landing[] | undefined>();

  for (const session of sessions) {
    if (session.repo === UNKNOWN_REPO) {
      continue;
    }
    if (!byRepo.has(session.repo)) {
      byRepo.set(session.repo, await landingsOrNothing(session.repo, since));
    }
    const landings = byRepo.get(session.repo);
    if (landings !== undefined) {
      session.landed = overlaps(session, landings);
    }
  }
}

async function landingsOrNothing(repo: string, since: Date): Promise<Landing[] | undefined> {
  try {
    return await landingsSince(repo, since);
  } catch {
    return undefined;
  }
}

/**
 * True when a commit reached the default branch between this session's first
 * and last call.
 *
 * A coincidence in time and nothing more. `outcome.ts` decides what merged by
 * comparing the blob a session left against the branch's history; this has no
 * such evidence and does not pretend to — which is why the report says
 * "overlapped a commit" and never "merged".
 */
export function overlaps(
  session: Pick<ScannedSession, "startedAt" | "endedAt">,
  landings: readonly Landing[],
): boolean {
  const from = Date.parse(session.startedAt);
  const to = Date.parse(session.endedAt);
  return landings.some((landing) => landing.at >= from && landing.at <= to);
}

/** True when a session ran in the checkout `--repo` named. */
function inRepo(session: ScannedSession, wanted: string): boolean {
  const left = path.resolve(session.repo);
  return left === wanted || left.startsWith(wanted + path.sep);
}

/**
 * Everything `scan` found, ready to render.
 *
 * The window is closed at "now" rather than left open: a transcript being
 * written while the scan runs would otherwise contribute calls that the
 * figures above it were computed without.
 */
export async function scanSessions(
  days: number,
  rates: RateTable,
  options: ScanOptions = {},
): Promise<{ report: ScanReport; sessions: ScannedSession[]; root: string }> {
  const root = options.root ?? defaultTranscriptRoot();
  const now = (options.now ?? (() => new Date()))();
  const to = now.getTime();
  const from = to - days * DAY_MS;

  const sessions = await scannedSessions(root, from, to);
  await groupByCheckout(sessions);

  const wanted = options.repo === undefined ? undefined : path.resolve(options.repo);
  const kept = wanted === undefined ? sessions : sessions.filter((one) => inRepo(one, wanted));

  await markLandings(kept, new Date(from));
  kept.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

  return { report: summarizeScan(kept, rates, days), sessions: kept, root };
}

/** True when there is a transcript directory to read at all. */
export async function transcriptsExist(options: ScanOptions = {}): Promise<boolean> {
  try {
    return (await stat(options.root ?? defaultTranscriptRoot())).isDirectory();
  } catch {
    return false;
  }
}
