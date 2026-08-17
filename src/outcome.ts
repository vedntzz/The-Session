import type { Session, SessionOutcome } from "./store.js";

/**
 * Where a session's work ended up.
 *
 * Deciding this is a question about content, not about commits. A branch that
 * was squash-merged has none of its original commits in the default branch —
 * asking `git branch --contains` about the session's start commit would report
 * almost every merged session as abandoned. What survives a squash, a rebase
 * and a cherry-pick alike is the bytes: if the file the session left is sitting
 * in the default branch's history at the same path, the work landed, whatever
 * happened to the commits that carried it.
 *
 * Everything here is pure. Reading the repository happens in `git.ts`, which
 * gathers the facts below once and hands them to every session being judged.
 */

/** How an outcome came to be recorded. */
export type OutcomeSource = "computed" | "manual";

/**
 * A recorded answer to "where did this end up", written into the log so the
 * dataset holds one rather than only ever recomputing it.
 */
export interface Observation {
  outcome: SessionOutcome;
  /** When the observation was made. ISO-8601. */
  observedAt: string;
  /** The default branch's tip when it was made — what "merged" meant that day. */
  commit: string;
  /** The branch it was judged against, e.g. `origin/main`. */
  branch: string;
  /** `computed` from the repo, or `manual` when a person overrode it. */
  source: OutcomeSource;
}

/**
 * What the repository says, gathered once for a whole run.
 *
 * Per path rather than per session: a week of twenty sessions touching the
 * same handful of files asks the same questions over and over, and the answers
 * do not depend on which session is asking.
 */
export interface RepoFacts {
  /** Display name of the default branch, e.g. `origin/main`. */
  branch: string;
  /** Its tip commit, recorded on any observation made against it. */
  tip: string;
  /** Every blob each path has held anywhere in the default branch's history. */
  history: ReadonlyMap<string, ReadonlySet<string>>;
  /** Paths absent at the tip — which is how a deletion shows up as landed. */
  absentAtTip: ReadonlySet<string>;
  /** What each path holds in the working tree now; null when it is not there. */
  working: ReadonlyMap<string, string | null>;
}

/** One file the session touched, and where its content is now. */
export interface FileEvidence {
  path: string;
  /** What the session left there. null means the session deleted the file. */
  ended: string | null;
  /** What is there now. null means nothing is. */
  working: string | null;
  /** True when what the session left is in the default branch's history. */
  landed: boolean;
}

/** The classification, and the evidence that produced it. */
export interface OutcomeVerdict {
  outcome: SessionOutcome;
  /** Paths whose content reached the default branch. */
  landed: string[];
  /** Paths still sitting in the working tree, unlanded. */
  inFlight: string[];
  /** Paths in neither place. */
  lost: string[];
}

/** True for an outcome that is not going to change on its own. */
export function isTerminal(outcome: SessionOutcome): boolean {
  return outcome === "merged" || outcome === "abandoned";
}

/** Reads an outcome off the command line, naming the alternatives when it is not one. */
export function parseOutcome(value: string): SessionOutcome {
  const wanted = value.trim().toLowerCase();
  if (wanted === "merged" || wanted === "abandoned" || wanted === "open") {
    return wanted;
  }
  throw new Error(`${value} is not an outcome. Use one of: open, merged, abandoned.`);
}

/**
 * Whether the content the session left at `path` reached the default branch.
 *
 * A deletion is the awkward case: there is no blob to look for, so what counts
 * is the path being gone at the tip. That is weaker than the test for content —
 * it cannot tell the session's deletion from someone else's — and it is the
 * best a content match can do about a file that is not there.
 */
function hasLanded(path: string, ended: string | null, facts: RepoFacts): boolean {
  if (ended === null) {
    return facts.absentAtTip.has(path);
  }
  return facts.history.get(path)?.has(ended) ?? false;
}

/**
 * What the repo says about each file this session left behind.
 *
 * Only paths the session has an end state for: without knowing what it left,
 * there is nothing to look for, and a path matched on name alone would credit
 * this session with whatever anyone else later put there.
 */
export function evidenceFor(session: Session, facts: RepoFacts): FileEvidence[] {
  const endState = session.endState ?? {};

  return session.reality
    .filter((path) => path in endState)
    .map((path) => {
      const ended = endState[path] ?? null;
      return {
        path,
        ended,
        working: facts.working.get(path) ?? null,
        landed: hasLanded(path, ended, facts),
      };
    });
}

/**
 * Where the work went, from the evidence.
 *
 * The order of the tests is what makes partial results readable. A session
 * whose files all landed is merged even though copies of them are still in the
 * working tree — which is the normal state of affairs after pulling the branch
 * you just merged into. A session with something landed and something still
 * sitting in the tree is still in flight: the rest has not gone in yet. Only
 * once nothing is in the tree does a partial landing count as merged, the
 * remainder having been dropped somewhere along the way.
 */
export function classify(files: readonly FileEvidence[]): OutcomeVerdict {
  const landed = files.filter((file) => file.landed).map((file) => file.path);
  // Content-equal, including both being absent: a deletion the session made
  // and nobody has undone is still sitting in the working tree.
  const present = files.filter((file) => file.working === file.ended);
  const inFlight = present.filter((file) => !file.landed).map((file) => file.path);
  const lost = files
    .filter((file) => !file.landed && file.working !== file.ended)
    .map((file) => file.path);

  const verdict = (outcome: SessionOutcome): OutcomeVerdict => ({
    outcome,
    landed,
    inFlight,
    lost,
  });

  // A session that left nothing behind has nothing anywhere to find. It is
  // over, and none of it survived — which is what abandoned means, even when
  // there was never anything to abandon.
  if (files.length === 0) {
    return verdict("abandoned");
  }
  if (landed.length < files.length && inFlight.length > 0) {
    return verdict("open");
  }
  if (landed.length > 0) {
    return verdict("merged");
  }
  return verdict("abandoned");
}

/** Every observation recorded against a session, oldest first. */
export function observations(session: Session): readonly Observation[] {
  return session.observations ?? [];
}

/** The most recent observation of any kind, or none. */
export function lastObservation(session: Session): Observation | undefined {
  return observations(session).at(-1);
}

/**
 * The most recent manual mark. A person who has said where a session went
 * outranks the computation: they can see a rename, a revert, or a merge into
 * a branch nobody told this tool about, and the computation cannot.
 */
export function manualOutcome(session: Session): Observation | undefined {
  return observations(session)
    .filter((observation) => observation.source === "manual")
    .at(-1);
}

/**
 * Where a session stands, worked out now rather than read off a stored field.
 *
 * Falls back to what the record says only when there is nothing to compute
 * from: outside a repository, with no default branch, or for a session stopped
 * before end states were recorded. Reporting the stored `open` there is a
 * refusal to guess, not an answer.
 */
export function effectiveOutcome(session: Session, facts?: RepoFacts): SessionOutcome {
  const manual = manualOutcome(session);
  if (manual) {
    return manual.outcome;
  }
  if (session.endedAt === null) {
    return "open"; // still running; nothing has been left anywhere yet
  }
  if (!facts || session.endState === undefined) {
    return session.outcome;
  }
  return classify(evidenceFor(session, facts)).outcome;
}

/** The verdict with its evidence, for the commands that explain themselves. */
export function judge(session: Session, facts: RepoFacts): OutcomeVerdict {
  return classify(evidenceFor(session, facts));
}
