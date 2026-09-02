import { factsFor } from "../observe.js";
import {
  attemptedNothing,
  effectiveOutcome,
  isTerminal,
  judge,
  lastObservation,
  observations,
  type Observation,
  type OutcomeVerdict,
  type RepoFacts,
} from "../outcome.js";
import {
  readSessions,
  updateSession,
  type Session,
  type SessionOutcome,
  type StoreOptions,
} from "../store.js";
import { intentOf, shortId } from "../render/terminal.js";
import { findSession } from "./show.js";

/**
 * Recording where the work went.
 *
 * `show` and `week` work the outcome out afresh every time, which is right for
 * a screen and wrong for a dataset: the answer depends on a branch that moves,
 * and a question asked next year against a rewritten history gets a different
 * answer with no way to tell that it changed. `settle` writes the answer down
 * — signed, chained, and stamped with the commit it was true against — so the
 * log holds a record rather than only ever a recomputation.
 */

/** One session `settle` acted on, or decided not to. */
export interface Settled {
  session: Session;
  outcome: SessionOutcome;
  /** The verdict's evidence, absent for a manual mark. */
  verdict?: OutcomeVerdict;
  /** False when the log already said this, so nothing was written. */
  recorded: boolean;
}

export interface SettleResult {
  /** The branch every judgement was made against. */
  branch?: string;
  settled: Settled[];
  /** Sessions still in flight, counted rather than listed. */
  stillOpen: number;
  /** Sessions that changed no files, counted rather than listed. */
  empty: number;
  /** Sessions with no end state to look for — stopped before it was recorded. */
  undecidable: number;
}

/** Appends an observation to a session, keeping the ones already there. */
async function record(
  session: Session,
  observation: Observation,
  options: StoreOptions,
): Promise<Session> {
  return updateSession(
    session.id,
    {
      observations: [...observations(session), observation],
      // The stored field is brought into line at the same time, so that a
      // reader of the raw JSONL — which is most of what this tool is for —
      // finds the settled answer without having to replay the computation.
      outcome: observation.outcome,
    },
    options,
  );
}

/** True when the log already records this outcome, from a settle or a mark. */
function alreadySaid(session: Session, outcome: SessionOutcome): boolean {
  return lastObservation(session)?.outcome === outcome;
}

function observe(
  outcome: SessionOutcome,
  facts: Pick<RepoFacts, "branch" | "tip">,
  source: Observation["source"],
): Observation {
  return {
    outcome,
    observedAt: new Date().toISOString(),
    commit: facts.tip,
    branch: facts.branch,
    source,
  };
}

/**
 * Writes down where every session that has finished ended up.
 *
 * Only terminal ones: a session still in flight has not ended up anywhere yet,
 * and recording `open` would be recording the absence of an answer. Re-running
 * is harmless — a session whose recorded outcome still matches is left alone —
 * but a session that has since changed gets a second observation rather than
 * an edited first one, so the log shows that it moved and when.
 */
export async function settleSessions(
  options: StoreOptions = {},
  gathered?: RepoFacts,
): Promise<SettleResult> {
  const sessions = await readSessions(options);
  // Gathered by the caller where there is one — the daily sweep asks the
  // repository once and hands the answers to both halves of itself. A `git log`
  // per path is the most expensive thing here, and twice in one command is
  // twice too many.
  const facts = gathered ?? (await factsFor(sessions, options.cwd ?? process.cwd()));

  const result: SettleResult = {
    ...(facts ? { branch: facts.branch } : {}),
    settled: [],
    stillOpen: 0,
    empty: 0,
    undecidable: 0,
  };

  for (const session of sessions) {
    const settlement = await settleOne(session, facts, options);
    if ("skipped" in settlement) {
      result[settlement.skipped] += 1;
    } else {
      result.settled.push(settlement.settled);
    }
  }

  return result;
}

/** The counters on `SettleResult` that stand for a session nothing was said about. */
type Skipped = "stillOpen" | "empty" | "undecidable";

/** Either what was written down about a session, or why nothing could be. */
type Settlement = { settled: Settled } | { skipped: Skipped };

/**
 * Where one session ended up.
 *
 * Only terminal outcomes are written: a session still in flight has not ended
 * up anywhere yet, and recording `open` would be recording the absence of an
 * answer.
 */
async function settleOne(
  session: Session,
  facts: RepoFacts | undefined,
  options: StoreOptions,
): Promise<Settlement> {
  if (session.endedAt === null) {
    return { skipped: "stillOpen" };
  }
  // Nothing to write down: `empty` is read off `reality` every time it is
  // asked, so an observation saying so would be a copy of a field that is
  // already on the record and can never disagree with it.
  if (attemptedNothing(session)) {
    return { skipped: "empty" };
  }
  if (!facts || session.endState === undefined) {
    return { skipped: "undecidable" };
  }

  const outcome = effectiveOutcome(session, facts);
  if (!isTerminal(outcome)) {
    return { skipped: "stillOpen" };
  }
  return { settled: await recordOutcome(session, outcome, facts, options) };
}

/**
 * Writes the observation, unless the record already says this.
 *
 * Re-running is harmless — a session whose recorded outcome still matches is
 * left alone — but a session that has since changed gets a second observation
 * rather than an edited first one, so the log shows that it moved and when.
 */
async function recordOutcome(
  session: Session,
  outcome: SessionOutcome,
  facts: RepoFacts,
  options: StoreOptions,
): Promise<Settled> {
  const settled: Settled = {
    session,
    outcome,
    verdict: judge(session, facts),
    recorded: !alreadySaid(session, outcome),
  };
  if (settled.recorded) {
    settled.session = await record(session, observe(outcome, facts, "computed"), options);
  }
  return settled;
}

/**
 * Records where a session went because a person says so.
 *
 * The computation can only see this repository's default branch. It cannot see
 * a rename, a revert, a merge into a release branch, or work that shipped as
 * somebody else's patch — so there has to be a way to say what happened, and
 * it is written as an observation like any other: signed, chained, and marked
 * `manual` so nothing later mistakes it for something the tool worked out.
 */
export async function markSession(
  id: string,
  outcome: SessionOutcome,
  options: StoreOptions = {},
): Promise<Settled> {
  const sessions = await readSessions(options);
  const session = findSession(sessions, id);
  refuseUnmarkable(session, outcome);

  // A mark stands whether or not the repo agrees, so the branch is recorded as
  // context rather than as grounds. Where there is none, the observation says
  // so plainly instead of pretending to a commit it never checked.
  const facts = await factsFor([session], options.cwd ?? process.cwd());
  const against = facts ?? { branch: "not checked", tip: "" };

  return {
    session: await record(session, observe(outcome, against, "manual"), options),
    outcome,
    recorded: true,
  };
}

/** The three things a mark cannot say, each refused in the words of its case. */
function refuseUnmarkable(session: Session, outcome: SessionOutcome): void {
  if (outcome === "empty") {
    throw new Error(
      `empty is not a mark. Whether a session changed anything is read off what it ` +
        `changed, every time it is asked, and saying so by hand could only ever agree ` +
        `or lie.`,
    );
  }
  if (session.endedAt === null) {
    throw new Error(
      `That session is still running. Run session stop first — where it ended up is ` +
        `not a thing that can be true yet.`,
    );
  }
  // A mark beats the computation because a person can see a rename, a revert
  // or another repo. None of that applies to a session that changed no files:
  // there is no work to have gone anywhere, so there is nothing to know better
  // about. If it did change files, the record of what it changed is what is
  // wrong, and a mark cannot repair that.
  if (attemptedNothing(session)) {
    throw new Error(
      `That session changed no files, so it did not end up anywhere — nothing was ` +
        `attempted, and nothing can be marked ${outcome}. If it did change files, it is ` +
        `the record of what it changed that is wrong, and a mark cannot fix that.`,
    );
  }
}

const LABEL_WIDTH = 9;

function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A short account of why a session was called what it was called. */
function because(verdict: OutcomeVerdict): string {
  const parts: string[] = [];
  if (verdict.landed.length > 0) {
    parts.push(`${plural(verdict.landed.length, "file", "files")} in the branch`);
  }
  if (verdict.inFlight.length > 0) {
    parts.push(`${plural(verdict.inFlight.length, "file", "files")} still in the tree`);
  }
  if (verdict.lost.length > 0) {
    parts.push(`${plural(verdict.lost.length, "file", "files")} nowhere`);
  }
  return parts.length > 0 ? parts.join(", ") : "nothing was left behind";
}

/** What `session settle` prints: one line per session it decided about. */
export function formatSettle(result: SettleResult): string[] {
  if (!result.branch) {
    return [
      line("branch", "none found — looked for origin/HEAD, main, master"),
      line("settled", "nothing; there is nothing to judge merged against"),
    ];
  }

  const wrote = result.settled.filter((settled) => settled.recorded).length;
  return [
    line("branch", result.branch),
    ...result.settled.map(settledLine),
    line("settled", `${plural(wrote, "session", "sessions")} recorded`),
    ...skippedLines(result),
  ];
}

/** One session's row: what it was called, and a short account of why. */
function settledLine(settled: Settled): string {
  const mark = settled.recorded ? settled.outcome : `${settled.outcome} (already)`;
  const why = settled.verdict ? because(settled.verdict) : "";
  return line(shortId(settled.session.id), `${mark.padEnd(20)}${why}`.trimEnd());
}

/** The sessions nothing was written down about, and why there was nothing. */
function skippedLines(result: SettleResult): string[] {
  const lines: string[] = [];
  if (result.stillOpen > 0) {
    lines.push(line("open", `${plural(result.stillOpen, "session", "sessions")}, still in flight`));
  }
  if (result.empty > 0) {
    const why =
      `${plural(result.empty, "session", "sessions")} changed no files, so there is ` +
      `nothing to have ended up anywhere`;
    lines.push(line("empty", why));
  }
  if (result.undecidable > 0) {
    const why =
      `${plural(result.undecidable, "session", "sessions")} stopped before end states ` +
      `were recorded, so there is nothing to look for`;
    lines.push(line("unknown", why));
  }
  return lines;
}

/** What `session mark` prints. */
export function formatMark(settled: Settled): string[] {
  return [
    line("marked", `${shortId(settled.session.id)}  ${settled.outcome}`),
    line("intent", intentOf(settled.session)),
    line("note", "recorded as a manual observation; it overrides what the repo says"),
  ];
}
