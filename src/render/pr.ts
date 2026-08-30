// The pull request a session's record already describes. Pure: one session and
// the rates in, one Markdown document out.
import { formatUsd, isPriced, priceSession, type RateTable } from "../pricing.js";
import { isCaptured, type Session } from "../store.js";
import { unpricedTokens } from "./terminal/cost.js";
import { CAPTURED_INTENT, intentOf, NO_SCOPE } from "./terminal/intent.js";

/**
 * The description somebody is about to write by hand, written from the record
 * instead.
 *
 * Everything in it is already on the session: what was declared, what changed,
 * what went outside the declaration, what it cost. **No model writes any of
 * this.** The tool has spent the whole session refusing to say what code
 * means, and a generated paragraph of prose about the work would be that
 * refusal abandoned at the last step — with the result pasted into a pull
 * request, under somebody's name, where a plausible sentence about code nobody
 * read is at its most expensive.
 *
 * So the document is a transcription. Its sentences are the developer's own
 * intent and a handful of file lists, and a reviewer who reads it is reading
 * the log rather than a summary of it. What it adds over `session show` is
 * only the shape: headings a reviewer expects, in a file `gh pr create` will
 * take on stdin.
 *
 * It leads with the intent rather than with where the work went, which is the
 * one place this departs from every other view here. There is nowhere for it
 * to have gone yet — the document exists to open the pull request that would
 * land it — so the first line is what the session set out to do, and the
 * outcome is a question for `session show` afterwards.
 */

/** The heading over what was declared at `session start`. */
const SCOPE_HEADING = "## Declared scope";

/** The heading over what actually changed. */
const CHANGED_HEADING = "## Changed";

/** The heading over the paths that went outside the declaration. */
const DRIFT_HEADING = "## Outside declared scope";

/** What the collapsed block under a truncated summary line is called. */
export const FULL_PROMPT = "Full prompt";

/** What the changed list says for a session that changed nothing. */
export const NOTHING_CHANGED = "No files changed.";

/** What the drift block says in a template when the work stayed inside. */
export const NO_DRIFT = "Nothing went outside the declared scope.";

/**
 * What the footer says when nothing was captured for the session.
 *
 * Never `$0.00 · 0 turns · 0 that changed no files`. A row of noughts has the
 * shape of a measurement, and what happened is that no adapter was recording —
 * the same call `show` makes when it drops its figures line entirely rather
 * than printing zeroes into it.
 */
export const NOTHING_MEASURED = "No cost recorded — nothing was captured for this session.";

/** The values a document is assembled from. */
export interface PrParts {
  /** The intent, as one line, with a captured one shortened and labelled. */
  intent: string;
  /**
   * The intent whole, exactly as it was recorded — newlines and all.
   *
   * The same string as `intent` for a declaration, which is never shortened.
   * For a captured prompt it is the part `intent` did not keep, and the reason
   * shortening is safe: nothing is lost, it is only folded away.
   */
  intent_full: string;
  /** The declared scope, or why there is none. */
  scope: string;
  /** What changed. */
  changed: string;
  /** What went outside the declaration, or that nothing did. */
  drift: string;
  /** What it cost, how many turns, and how many of those changed nothing. */
  cost: string;
}

/** The placeholders a `--template` may use. Nothing else is accepted. */
export const PR_PLACEHOLDERS = [
  "intent",
  "intent_full",
  "scope",
  "changed",
  "drift",
  "cost",
] as const;

export type PrPlaceholder = (typeof PR_PLACEHOLDERS)[number];

/**
 * The five values, plain: no emphasis, no headings.
 *
 * Plain because a template supplies its own — an author who wrote their own
 * heading over `{{changed}}` has said how it should look, and a value arriving
 * pre-italicised would fight them. The default document below adds what
 * emphasis there is.
 */
export function prParts(session: Session, rates: RateTable): PrParts {
  const summary = summarize(session);
  return {
    intent: summary.line,
    intent_full: summary.full,
    scope: session.scope.length === 0 ? NO_SCOPE : listOf(session.scope),
    changed: session.reality.length === 0 ? NOTHING_CHANGED : listOf(session.reality),
    drift: driftBlock(session),
    cost: costLine(session, rates),
  };
}

/**
 * The document `session pr` prints.
 *
 * The order is every other view's: what was asked for, what happened, what
 * went outside the plan, and the money last and quietest. A pull request is
 * read by somebody deciding whether to approve it, and what they need first is
 * the claim they are checking the diff against.
 *
 * The drift section is **dropped entirely** where there is nothing to put in
 * it. A heading over "none" is a heading that trains a reviewer to skip the
 * section, and the one time it matters is the one time they will not read it.
 */
export function renderPr(session: Session, rates: RateTable): string {
  const parts = prParts(session, rates);
  // The same rule asked twice, which is cheaper than a second way of asking:
  // `summarize` is where truncation is decided, and nothing else may decide it.
  const { cut, full } = summarize(session);

  return blocksOf([
    parts.intent,
    ...(cut ? [fullPromptBlock(full)] : []),
    SCOPE_HEADING,
    parts.scope,
    CHANGED_HEADING,
    parts.changed,
    ...(hasDrift(session) ? [DRIFT_HEADING, parts.drift] : []),
    `_${parts.cost}_`,
  ]);
}

/** The summary line, the whole text, and whether the first is short of it. */
interface Summary {
  /** What the document opens with. */
  line: string;
  /** The intent as recorded, trimmed and otherwise untouched. */
  full: string;
  /** Whether `line` stops short of `full` — the one thing that adds a block. */
  cut: boolean;
}

/**
 * The intent as one line, with a captured one shortened and saying so.
 *
 * The label is part of the line rather than a note under it, so that it
 * survives into a template that only asked for `{{intent}}`. A reviewer is
 * being told what this text is: a declaration made before the work is a
 * promise the diff can be held to, and a first prompt is what somebody
 * happened to type at an agent. Reading the second as the first is the whole
 * misunderstanding `intentSource` exists to prevent, and a pull request is
 * where it would do the most damage.
 *
 * **A declaration is never shortened.** Somebody typed it as the whole of what
 * they were setting out to do, and every word of it is the promise the diff is
 * being held to. It is flattened onto one line — no words are lost that way —
 * and nothing else happens to it.
 *
 * **A captured prompt is**, because it is not that. It is the first thing
 * somebody said to an agent, and it arrives at any length: a paragraph of
 * context, a stack trace, a pasted file. Opening a pull request with all of it
 * buries every heading under it, and the reviewer scrolls past the document to
 * reach the diff. So the line takes the first sentence or the first line,
 * whichever ends sooner, and the rest is folded into `fullPromptBlock` — one
 * click away, never dropped. **No model is asked to summarise it**, which is
 * the whole reason the rule is these two lines of string handling: a generated
 * précis of somebody's prompt, posted under their name, is exactly the thing
 * invariant 3 exists to refuse.
 */
function summarize(session: Session): Summary {
  const full = intentOf(session).trim();

  if (!isCaptured(session)) {
    return { line: flatten(full), full, cut: false };
  }

  const end = Math.min(sentenceEnd(full), lineEnd(full));
  return {
    line: `${flatten(full.slice(0, end))} (${CAPTURED_INTENT})`,
    full,
    // On the index rather than on the text: the head is flattened for the line
    // and the whole text is not, so comparing the two would call a run of
    // spaces a truncation and open a block over nothing.
    cut: end < full.length,
  };
}

/** One line's worth of whitespace, so a summary line is a line. */
function flatten(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
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
 * of being wrong is one click on a block that holds every word.
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
 * The prompt, whole, folded into a block a reviewer can open.
 *
 * Fenced, and the fence is the point. Everything in this block is text
 * somebody typed at an agent, and it can hold anything — Markdown headings, a
 * table, HTML, and in particular a literal `</details>`, which would close this
 * block early and spill the rest of the prompt into the pull request as
 * markup. Inside a fence none of it is anything but characters. It also keeps
 * the prompt's own line breaks, which a paragraph would collapse.
 *
 * The fence is longer than the longest run of backticks in the text, so a
 * prompt with a code block in it — which is most of them — cannot close the
 * fence from the inside either.
 *
 * The blank lines around it are what make a Markdown block inside an HTML one
 * render at all on GitHub.
 */
function fullPromptBlock(full: string): string {
  const fence = "`".repeat(Math.max(3, longestBackticks(full) + 1));
  return [
    `<details><summary>${FULL_PROMPT}</summary>`,
    "",
    fence,
    full,
    fence,
    "",
    "</details>",
  ].join("\n");
}

/** The longest run of backticks in the text, or nought where there are none. */
function longestBackticks(text: string): number {
  return Math.max(0, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
}

/** Whether there is a drift section to print at all. */
function hasDrift(session: Session): boolean {
  return session.scope.length > 0 && session.drift.length > 0;
}

/**
 * What went outside the declaration.
 *
 * Nothing is ever reported as drift for a session that declared no scope, even
 * where the record holds paths: drift is the distance between a declaration
 * and reality, and without a declaration there is no distance — `driftOf` says
 * the same thing at the other end, and `show` says it to the reader. A pull
 * request telling a reviewer that twelve files went outside a plan nobody made
 * would be an accusation the log cannot support.
 */
function driftBlock(session: Session): string {
  if (session.scope.length === 0) {
    return NO_SCOPE;
  }
  return session.drift.length === 0 ? NO_DRIFT : listOf(session.drift);
}

/**
 * Every path, one per line.
 *
 * **Not through `summarizePaths`**, and this is the one view that does not
 * use it. That cap exists because a terminal line has a width and a sentence
 * naming twelve files is one nobody finishes — neither is true here. A pull
 * request body has no width, it is read scrolling rather than at a glance, and
 * the list of files is not context around the point: it is the thing being
 * reviewed. `40 files, mostly in src/` tells a reviewer to go and find out
 * what they are, which is the work this document exists to have already done.
 *
 * So no count stands in for the paths anywhere in here, and nothing is
 * dropped.
 */
function listOf(paths: readonly string[]): string {
  return grouped(paths)
    .map((path) => `- ${path}`)
    .join("\n");
}

/**
 * The paths ordered so that a directory's files sit together, each group
 * sorted inside itself.
 *
 * Sorting the paths alone would not do it. `src/a.ts`, `src/api/orders.ts` and
 * `src/b.ts` sort in that order, dropping a file from another directory into
 * the middle of `src/` — over forty paths that reads as no order at all, and a
 * reviewer checking whether anything unexpected was touched is scanning
 * directories rather than filenames.
 *
 * Full paths, never a directory heading with bare filenames under it: a path
 * in a pull request body gets copied into a `git log` or a search box, and
 * half of one is no use there.
 *
 * Top-level files come first, since their directory is the empty string. The
 * order is total either way, so two runs over one session read the same.
 */
function grouped(paths: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const directory = path.slice(0, path.lastIndexOf("/") + 1);
    groups.set(directory, [...(groups.get(directory) ?? []), path]);
  }

  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, files]) => [...files].sort((left, right) => left.localeCompare(right)));
}

/**
 * The closing line: what it cost, how many turns that took, and how many of
 * those changed no files.
 *
 * The three figures `show` closes on, in its order and for its reasons. The
 * money is last and unemphasised — the agents meter their own spend, so a
 * document that opened on a dollar figure would answer a question its reader
 * has already had answered.
 *
 * A model no rate covers reads as its tokens and its name, through the one
 * function `week`, `scan` and `stop` all say that with. Never `$0.00`: nought
 * is what this tool prints when it means nought, and a session nobody can
 * price is one nobody knows the cost of.
 */
function costLine(session: Session, rates: RateTable): string {
  const { cost } = session;
  if (cost.turns === 0 && cost.apiCalls === 0) {
    return NOTHING_MEASURED;
  }

  const price = priceSession(cost, rates);
  const spent = isPriced(price) ? formatUsd(price.usd) : unpricedTokens(cost);
  const turns = cost.turns === 1 ? "1 turn" : `${cost.turns} turns`;
  return `${spent} · ${turns} · ${cost.emptyTurns} that changed no files`;
}

/** Joins the blocks that have anything in them, one blank line between. */
function blocksOf(blocks: readonly string[]): string {
  return blocks.filter((block) => block !== "").join("\n\n");
}

// --- templates -----------------------------------------------------------

/**
 * Anything in double braces, whatever is inside it.
 *
 * Deliberately not just the five names: a template that says `{{author}}` has
 * to be told so, and a pattern that only matched the known ones would leave
 * that in the output as literal braces for somebody to find in the pull
 * request they had already opened. Whitespace inside is allowed, so
 * `{{ intent }}` works and is refused by the same name.
 */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/gu;

/**
 * A template with its placeholders filled in.
 *
 * The five values are the same ones the default document is built from, which
 * is the point of the flag: a team's own pull request format, filled from the
 * record rather than from a model.
 *
 * An unknown placeholder is **refused by name**, and every unknown one is
 * named at once. The alternative — leaving it in the output — puts `{{autor}}`
 * in a pull request body, where it is found by a reviewer rather than by the
 * person who could have fixed the typo in one keystroke.
 */
export function fillTemplate(template: string, parts: PrParts, source?: string): string {
  const used = [...template.matchAll(PLACEHOLDER)].map((match) => (match[1] ?? "").trim());
  const unknown = [...new Set(used.filter((name) => !isPlaceholder(name)))];

  if (unknown.length > 0) {
    throw new Error(unknownPlaceholders(unknown, source));
  }
  return template.replace(PLACEHOLDER, (_whole, name: string) => parts[nameOf(name)]);
}

function isPlaceholder(name: string): name is PrPlaceholder {
  return (PR_PLACEHOLDERS as readonly string[]).includes(name);
}

/** The name inside the braces, already known to be one of the five. */
function nameOf(raw: string): PrPlaceholder {
  return raw.trim() as PrPlaceholder;
}

/** What to say about braces this document cannot fill, and what to write instead. */
function unknownPlaceholders(unknown: readonly string[], source?: string): string {
  const named = unknown.map((name) => `{{${name}}}`).join(", ");
  const where = source === undefined ? "" : ` in ${source}`;
  const verb = unknown.length === 1 ? "is not a placeholder" : "are not placeholders";
  const known = PR_PLACEHOLDERS.map((name) => `{{${name}}}`).join(", ");
  return `${named}${where} ${verb}. Use one of: ${known}.`;
}
