// `session week <id>`'s three sentences: where the work went, what was asked for, what went outside.
import {
  inOwnWords,
  intentSourceOf,
  type IntentSource,
  type Session,
  type SessionOutcome,
} from "../../store.js";
import { headOf, noIntentSentence } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { flatten, plural, shortId } from "./text.js";

/**
 * The first sentence of all: where the work ended up.
 *
 * Read off `outcome`, which by the time a view runs holds what the repository
 * says now rather than what the record was written with — see `withOutcomes`.
 * The full view spends a labelled row on the same fact; here it is a sentence,
 * and it comes first because it is the question the reader opened `week <id>` with.
 *
 * Four ends, four sentences, and each says only what its evidence supports. A
 * session still open has not landed and has not failed to, so it is not told
 * it did either. A session that changed no files never had anything to land,
 * and the sentence below it says that in its own words.
 *
 * "Landed on the default branch" rather than "shipped" or "merged": it is the
 * plainest description of the thing `outcome.ts` actually checked, which is
 * whether what the session left is in the default branch's history.
 */
export const WHERE_IT_WENT: Record<SessionOutcome, string> = {
  merged: "The work landed on the default branch.",
  abandoned: "The work did not land on the default branch.",
  open: "The work has not landed on the default branch yet.",
  empty: "Nothing landed on the default branch.",
};

/** What `week <id>` says when a session has no scope to have drifted from. */
const NO_DRIFT_POSSIBLE =
  "Nothing was declared to compare against — run session start --scope to see drift.";

/**
 * The sentence each intent source is framed in, quoted words in the middle.
 *
 * One table, so a source added later cannot leave this view claiming the words
 * were the developer's. An intent that is not theirs says so in the sentence
 * rather than in a line of its own — it is the same fact the full view spends
 * a row on, and here it is a clause.
 */
const ASKED_FOR: Record<IntentSource, AskedFrame> = {
  declared: { whole: 'You asked for "', after: '".' },
  primed: { whole: 'You asked for "', after: '", with scope reviewed through Prime.' },
  captured: {
    whole: 'Your first prompt was "',
    // Only where something was left out. "began" in front of a prompt that is
    // printed whole would be claiming there is more of it, which is the same
    // kind of lie in the other direction.
    begun: 'Your first prompt began "',
    after: '", and you declared nothing up front.',
  },
};

/** The words around a quoted intent: one opening for all of it, one for a head of it. */
interface AskedFrame {
  whole: string;
  begun?: string;
  after: string;
}

/**
 * Where a reader who wants the rest of a shortened prompt is sent.
 *
 * Only printed where something was actually left out. A pointer to a fuller
 * view under a prompt that is already whole is a line that teaches the reader
 * to ignore the line.
 */
function restOf(session: Session): string {
  return ` Run session week ${shortId(session.id)} --full for the whole of it.`;
}

/**
 * The second sentence: what was asked for.
 *
 * Returned in three pieces so the intent itself can be inked without the
 * sentence around it going bold too.
 */
export function askedFor(session: Session): { before: string; intent: string; after: string } {
  if (session.intent === null) {
    // Nothing to ink, so the whole sentence is the frame.
    return { before: noIntentSentence(session), intent: "", after: "" };
  }
  // Quoted, and the quotes sit outside the ink. Somebody's own words run into
  // the sentence around them otherwise, and the reader who most needs this
  // view is the one reading it with colour turned off in a log.
  const frame = ASKED_FOR[intentSourceOf(session)];
  // A declaration prints whole, however long: it is the promise the diff is
  // held to, and a view that showed half of it would be hiding the yardstick
  // it is measuring against. A prompt the hook captured is not a promise and
  // runs to paragraphs, so it is shortened by the rule `pr` shortens it with
  // — first sentence or first line — and the reader is told where the rest is.
  if (inOwnWords(session)) {
    return { before: frame.whole, intent: flatten(session.intent), after: frame.after };
  }
  const { head, cut } = headOf(session.intent);
  return {
    before: cut ? (frame.begun ?? frame.whole) : frame.whole,
    intent: flatten(head),
    after: `${frame.after}${cut ? restOf(session) : ""}`,
  };
}

/**
 * The third sentence: what went outside what was declared.
 *
 * Four cases, ordered by which fact a tired reader most needs. Something went
 * outside, and here it is; nothing changed at all; nothing was declared, so
 * the question cannot be asked; everything stayed inside.
 */
export function wentOutside(session: Session): { before: string; paths: string; after: string } {
  if (session.drift.length > 0) {
    const files = plural(session.drift.length, "file", "files");
    const declared = `${files} changed outside what you declared`;
    // The count in front is always exact; the paths are what gets dropped when
    // there are too many of them to read, and `--full` still has every one.
    const summary = summarizePaths(session.drift);
    if (summary.named.length === 0) {
      return { before: `${declared}, ${summary.where}.`, paths: "", after: "" };
    }
    return { before: `${declared}: `, paths: summary.named.join(", "), after: "." };
  }
  // Before the scope check, because it is the stronger fact. A session that
  // changed nothing had nothing to go outside a scope, declared or not, and
  // sending that reader off to `--scope` would answer a question they do not
  // have.
  if (session.reality.length === 0) {
    return { before: "It changed no files at all.", paths: "", after: "" };
  }
  if (session.scope.length === 0) {
    return { before: NO_DRIFT_POSSIBLE, paths: "", after: "" };
  }
  return { before: "Everything it changed stayed inside what you declared.", paths: "", after: "" };
}
