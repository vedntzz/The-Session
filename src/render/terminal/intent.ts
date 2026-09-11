// What a view calls an intent, and the markers that survive a pipe.
import {
  INTENT_SOURCES,
  intentSourceOf,
  type IntentSource,
  type Session,
} from "../../store.js";

/**
 * Marks drift where colour cannot: piped output, a log file, a screenshot,
 * a terminal someone has turned colour off in.
 */
export const DRIFT_MARKER = "!";

/**
 * Marks an intent the developer did not compose. Like `DRIFT_MARKER`, these
 * are characters rather than inks, so the distinction survives a pipe, a log
 * file and a screenshot; the tables that use them say what they mean
 * underneath.
 *
 * One table, read by the week table, the Markdown document and the HTML page
 * alike. A marker drawn one way in one view and another way in the next is a
 * distinction the reader has to learn twice.
 */
export const INTENT_MARKER: Record<IntentSource, string> = {
  declared: "",
  captured: "~",
};

/**
 * What `show` and `pr` say about where an intent came from, where that is
 * worth saying. A declaration needs no note: it is the case the rest are
 * marked against.
 */
export const INTENT_NOTE: Record<IntentSource, string | undefined> = {
  declared: undefined,
  captured: "captured from the first prompt, not declared",
};

/**
 * The legend under a table, per source, spelled out for a reader who has just
 * met the marker.
 */
export const INTENT_LEGEND: Record<IntentSource, string | undefined> = {
  declared: undefined,
  captured:
    "recorded by the editor hook: intent captured from the first prompt, no scope declared",
};

/** One legend to print: which marker, how many rows carry it, and what it means. */
export interface IntentLegend {
  source: IntentSource;
  marker: string;
  count: number;
  text: string;
}

/**
 * The legends a set of rows has earned, in `INTENT_SOURCES` order.
 *
 * Only sources with a row here and something to explain: a legend for a marker
 * nobody used is a line the reader has to check the table against to find out
 * it says nothing. Built by walking the list, so a source added later is
 * counted and explained by every table at once rather than by whichever
 * renderer was remembered.
 */
export function intentLegends(
  sessions: readonly Pick<Session, "intentSource">[],
): IntentLegend[] {
  const legends: IntentLegend[] = [];
  for (const source of INTENT_SOURCES) {
    const text = INTENT_LEGEND[source];
    if (text === undefined) {
      continue;
    }
    const count = sessions.filter((session) => intentSourceOf(session) === source).length;
    if (count > 0) {
      legends.push({ source, marker: INTENT_MARKER[source], count, text });
    }
  }
  return legends;
}

/** An intent with the marker its source calls for, ready to go in a cell. */
export function markedIntent(session: Pick<Session, "intent" | "endedAt" | "intentSource">): string {
  const marker = INTENT_MARKER[intentSourceOf(session)];
  const intent = intentOf(session);
  return marker === "" ? intent : `${marker} ${intent}`;
}

/** What `show` says instead of a scope, for a session nobody declared one for. */
export const NO_SCOPE = "no scope — nothing was declared to drift from";

/** Where a reader who wants drift is sent. */
export const SCOPE_HINT = "← session start --scope is what makes drift visible";

/** How a session with no intent yet reads. */
export const NO_INTENT_OPEN = "(no prompt yet)";

/** How a session that ended without ever being given one reads. */
export const NO_INTENT_ENDED = "(no prompt)";

/**
 * The intent as any view prints it.
 *
 * A passive session that has not had a prompt yet has no words to show, and a
 * session that ended before one arrived never will. Both say so rather than
 * printing an empty column: a blank would read as a session whose intent was
 * lost, and nothing was lost — nothing was ever said.
 */
export function intentOf(session: Pick<Session, "intent" | "endedAt">): string {
  if (session.intent !== null) {
    return session.intent;
  }
  return session.endedAt === null ? NO_INTENT_OPEN : NO_INTENT_ENDED;
}

// --- shortening somebody's own words -------------------------------------

/**
 * The head of a prompt, and whether anything was left behind.
 *
 * `head` is the first sentence or the first line, whichever ends sooner; `cut`
 * says a view that prints only the head is not printing all of it, and so owes
 * the reader a way to the rest.
 */
export interface IntentHead {
  head: string;
  cut: boolean;
}

/**
 * Where the first sentence ends, or the whole length when none does.
 *
 * A full stop, question mark or exclamation mark that is followed by
 * whitespace or by nothing at all. The trailing test is what keeps
 * `src/api/orders.ts` and `v1.2` whole, since the stop inside them is followed
 * by a letter or a digit; `...` and `?!` end where the run does, for the same
 * reason.
 *
 * It will cut early on an abbreviation — "e.g. the limiter" ends at `e.g.` —
 * and that is a real miss, taken knowingly. The rule has to be one a reader
 * can predict from the sentence describing it, the alternative is a list of
 * abbreviations in a tool that has no business knowing English, and the cost
 * of being wrong is that the reader opens the view that holds every word.
 */
function sentenceEnd(text: string): number {
  const found = /[.?!](?=\s|$)/u.exec(text);
  return found ? found.index + 1 : text.length;
}

/** Where the first line ends, or the whole length when there is one line. */
function lineEnd(text: string): number {
  const at = text.indexOf("\n");
  return at === -1 ? text.length : at;
}

/**
 * Shortens a prompt to the one line a view has room for.
 *
 * The one rule, shared. `render/pr.ts` spends it on a summary line with the
 * whole prompt folded into a block underneath; `show` and the bare screen
 * spend it on a sentence with `session show --full` underneath. Two copies of
 * it would be two chances for the pull request body and the terminal to
 * disagree about where somebody's first sentence ended.
 *
 * **Only ever applied to words the developer did not compose.** A declaration
 * is the promise the diff is held to and prints whole wherever it prints at
 * all — see `inOwnWords`. And no model is asked to summarise anything: the
 * whole rule is these two string searches, which is what invariant 3 requires
 * of a view that shortens somebody's prompt.
 *
 * Measured on the index rather than on the text, because the head is flattened
 * for the line and the whole text is not — comparing the two would call a run
 * of spaces a truncation.
 */
export function headOf(text: string): IntentHead {
  const end = Math.min(sentenceEnd(text), lineEnd(text));
  return { head: text.slice(0, end), cut: end < text.length };
}
