// The shape of a session and of one line of the log. Pure: no disk, no git.
import type { SessionClass } from "../classify.js";
import type { Observation } from "../outcome.js";
import type { Attribution } from "../config.js";
/**
 * The four token counters, kept separate because the four kinds bill at
 * different rates. Collapsing them to one number throws away the information a
 * price calculation needs, so nothing in the record ever does.
 */
export interface TokenCounts {
  /** Fresh input, billed at the full input rate. */
  inputTokens: number;
  /** Input served from cache, billed at a discount. */
  cacheReadTokens: number;
  /** Input written into cache, billed at a premium. */
  cacheCreationTokens: number;
  outputTokens: number;
}

/** What the session spent to get where it got. */
export interface SessionCost extends TokenCounts {
  /** Developer turns: one per prompt, covering everything it set off. */
  turns: number;
  /** Turns that wrote no files — a whole prompt that produced nothing. */
  emptyTurns: number;
  /** API calls observed, after streaming fragments are collapsed. */
  apiCalls: number;
  /** Calls that wrote no files: they cost tokens and changed nothing. */
  callsWithoutEdits: number;
  model: string;
  /**
   * The same four counters, restricted to the turns that wrote no files.
   *
   * Counted at capture, where which turn a call belonged to is still known, so
   * that what the waste cost is a measurement. The alternative — taking the
   * session's total and multiplying by the share of turns that were empty —
   * would be a number nobody observed: empty turns are not average turns, and
   * the expensive ones are exactly the ones worth seeing.
   *
   * Absent on sessions captured before this existed. Nothing infers it.
   */
  emptyTurnTokens?: TokenCounts;
}

/** Every token the session moved. For display only — never for pricing. */
export function totalTokens(tokens: TokenCounts): number {
  return (
    tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens + tokens.outputTokens
  );
}

/** Four counters at nothing. */
export function zeroTokens(): TokenCounts {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
}

/** A cost record with nothing counted yet. */
export function zeroCost(): SessionCost {
  return {
    ...zeroTokens(),
    turns: 0,
    emptyTurns: 0,
    apiCalls: 0,
    callsWithoutEdits: 0,
    model: "",
    emptyTurnTokens: zeroTokens(),
  };
}

/**
 * Where the session landed. Distinct from whether it is still running: a
 * session that has stopped is still `open` until it merges or is abandoned.
 *
 * `empty` is the fourth because "where did it land" has no answer for a
 * session that changed no files. Nothing was attempted, so nothing was
 * abandoned — and calling it abandoned would put a session that never wrote a
 * line into every figure about work that was thrown away. It is read off
 * `reality`, never declared. See `outcome.ts`.
 */
export type SessionOutcome = "open" | "merged" | "abandoned" | "empty";

/**
 * Where a session's intent came from.
 *
 * `declared` was typed by the developer at `session start`, before the agent
 * ran. `captured` was taken from the first prompt of a session the editor hook
 * opened on its own — the same words, in the same order, but nobody chose to
 * write them down as a declaration.
 *
 * The two are kept apart everywhere because they are different evidence. A
 * declaration is a commitment made in advance; a captured intent is a
 * transcript of what was asked for. Both are written before anything happened,
 * and neither can be edited afterwards — but a reader comparing intent to
 * reality is owed the fact that one of them was never a promise.
 */
export type IntentSource = "declared" | "captured";

/**
 * Reads an intent source off the command line.
 *
 * The two words are the two the record uses, so what `week --intent` takes is
 * what the field says — a reader who has seen one has seen the other.
 */
export function parseIntentSource(value: string): IntentSource {
  const wanted = value.trim().toLowerCase();
  if (wanted === "declared" || wanted === "captured") {
    return wanted;
  }
  throw new Error(`${value} is not an intent source. Use one of: declared, captured.`);
}

export interface Session {
  id: string;
  /** Normalized repo identity, e.g. `remote:github.com/acme/tool`. */
  repo: string;
  /**
   * What the session set out to do. Written once, never edited.
   *
   * `null` only on a passively opened session that has not seen a prompt yet,
   * and only until the first one arrives. A session that ended without one
   * keeps it: nothing was declared and nothing was asked, and writing words
   * there afterwards would be inventing them.
   */
  intent: string | null;
  /**
   * Which of the two `intent` is. Absent on records written before passive
   * capture existed, where it reads as `declared` — nothing but `session
   * start` could have written one then, so this is a fact about those records
   * rather than a guess about them.
   */
  intentSource?: IntentSource;
  /** The paths the developer declared. May be empty. */
  scope: string[];
  /**
   * Paths already modified when the session opened. Subtracted from `reality`
   * so a session is not blamed for work that was sitting there before it.
   */
  baseline: string[];
  /** The paths that actually changed, observed from git. */
  reality: string[];
  /** `reality` minus `scope` — recorded, never blocked. */
  drift: string[];
  /**
   * What the session was mostly working on — schema, api, ui, test, config,
   * docs, build, other — derived from `reality` at `stop` by the path rules in
   * `classify.ts`. Absent on sessions stopped before it existed; readers
   * derive it from `reality` instead, which is the same computation.
   */
  class?: SessionClass;
  cost: SessionCost;
  outcome: SessionOutcome;
  /** ISO-8601 timestamp. */
  startedAt: string;
  /** ISO-8601 timestamp. `null` means the session is still running. */
  endedAt: string | null;
  /**
   * The blob id of each `reality` path as the session left it, captured at
   * `stop`. `null` means the session deleted the file.
   *
   * This is what makes an outcome decidable later. Whether the work merged is
   * a question about content — a squash merge keeps none of the original
   * commits — and without a record of what the session actually left there is
   * nothing to go looking for. A fact about what happened, like `reality`, not
   * a conclusion drawn from it. Absent on sessions stopped before it existed.
   */
  endState?: Record<string, string | null>;
  /**
   * Where the session was observed to have ended up, oldest first. Written by
   * `session settle` and `session mark`; never the basis for display, which is
   * computed afresh. See `outcome.ts`.
   */
  observations?: Observation[];
  /** HEAD when the session opened, so its diff can be recovered later. */
  startCommit: string;
  /**
   * Who the work was for, copied out of the repo's `.session.json` when the
   * session opened. Absent when the repo declares none.
   *
   * A copy, not a reference: a session records what the repo said at the time
   * it ran. Re-reading the file at display time would let a change of client
   * today rewrite who last quarter was billed to.
   */
  attribution?: Attribution;
}

/**
 * Which kind of intent a session carries.
 *
 * Absent means `declared`: passive capture did not exist when those records
 * were written, so `session start` is the only thing that could have opened
 * them. Same shape as `classOf` — the stored field is written for whoever
 * reads the raw JSONL, and every reader derives the same answer without it.
 */
export function intentSourceOf(session: Pick<Session, "intentSource">): IntentSource {
  return session.intentSource ?? "declared";
}

/** True when the intent was taken from a prompt rather than declared up front. */
export function isCaptured(session: Pick<Session, "intentSource">): boolean {
  return intentSourceOf(session) === "captured";
}

/** The `set` payload of a record. Creating records carry every field. */
export type RecordFields = Partial<Omit<Session, "id">>;

/**
 * Fields `updateSession` may set. Four are absent by design: intent is written
 * once — at `start`, or from the first prompt of a passive session, which is
 * what `captureIntent` is for and the only way it is ever written twice —
 * `intentSource` says which of those happened and so is fixed when the session
 * opens, repo is derived from where the store lives, and attribution is
 * captured at start so that who was billed cannot be decided after the fact.
 */
export type SessionPatch = Omit<
  RecordFields,
  "intent" | "intentSource" | "repo" | "attribution"
>;

/**
 * What a caller supplies at `session start`. Everything a session cannot know
 * yet — reality, drift, cost, where it ended up — is defaulted here and filled
 * in by later patches. `repo` is derived from the store's cwd, never passed.
 */
export type NewSession = Partial<Omit<Session, "id" | "repo">> &
  Pick<Session, "intent" | "startedAt" | "startCommit"> & { id?: string };

export interface StoreOptions {
  /** Store root. Defaults to $SESSION_HOME, else ~/.session. */
  home?: string;
  /** Directory used to derive the repo key. Defaults to process.cwd(). */
  cwd?: string;
}

/**
 * One line of the log. Records are patches keyed by session id: the first
 * record for an id creates it, later records overlay fields onto it. Nothing
 * is ever rewritten in place, so a crash can only ever lose a trailing line.
 */
export interface LogRecord {
  v: number;
  id: string;
  /** When the record was written, distinct from the session's own times. */
  at: string;
  set: RecordFields;
  /**
   * SHA-256 of the previous line as it sits on disk, `GENESIS` for the first.
   * Undefined on records written before the log was tamper-evident.
   */
  prev?: string;
  /** Fingerprint of the key that signed it, so a verifier knows which to want. */
  key?: string;
  /** SHA-256 of this record's body — see `chain.ts`. */
  hash?: string;
  /** Base64 Ed25519 signature over `hash`. */
  sig?: string;
}

/** Bumped only if the on-disk record shape changes incompatibly. */
export const RECORD_VERSION = 1;
