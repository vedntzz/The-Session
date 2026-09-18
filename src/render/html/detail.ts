// What a row opens: the declaration against the diff, and the counters behind
// the figures in the row. Every meaning here is imported — `emptyTurnsOf` for
// which turns produced nothing, `priceSession` for money, `observations` for
// where the work went. Nothing is worked out a second time on the page.
import { emptyTurnsOf } from "../../empty.js";
import { observations } from "../../outcome.js";
import { formatUsd, isPriced, priceSession, wasMeasured, type RateTable } from "../../pricing.js";
import { hasDeclaredScope, intentSourceOf, type Session } from "../../store.js";
import { INTENT_NOTE } from "../terminal.js";
import { escapeHtml, figure, plural } from "./text.js";

/** A path, with the note that says why it is listed the way it is. */
function pathItem(path: string, tone: string, tag?: string): string {
  const label = tag === undefined ? "" : `<span class="tag">${escapeHtml(tag)}</span>`;
  return `<li class="${tone}">${escapeHtml(path)}${label}</li>`;
}

function pathList(items: readonly string[], tone: string): string {
  return `<ul class="paths">${items.map((path) => pathItem(path, tone)).join("")}</ul>`;
}

function heading(text: string): string {
  return `<p class="pane-label">${escapeHtml(text)}</p>`;
}

function statement(text: string, tone = "said"): string {
  return `<p class="${tone}">${escapeHtml(text)}</p>`;
}

/**
 * Prime's suggestion, kept whole beside the scope that was accepted.
 *
 * Both lists print even where they are the same. The proposal is immutable
 * like the intent, so a reader a month later can still see what was offered,
 * and only the accepted scope is ever what drift is measured against.
 */
function proposalPane(session: Session): string {
  const proposed = session.proposal?.scope ?? [];
  const dropped = proposed.filter((path) => !session.scope.includes(path));
  const items = proposed
    .map((path) =>
      session.scope.includes(path)
        ? pathItem(path, "kept", "accepted")
        : pathItem(path, "dropped", "not accepted"),
    )
    .join("");
  return (
    heading("Prime proposed — immutable") +
    `<ul class="paths">${items}</ul>` +
    statement(
      dropped.length === 0
        ? "The proposal was accepted whole, and is kept on the record in its own right."
        : `${plural(dropped.length, "path was", "paths were")} not accepted. The proposal is` +
          " kept exactly as offered, including the parts that were replaced.",
    )
  );
}

/** The accepted scope, marking what replaced Prime's suggestion. */
function acceptedPane(session: Session): string {
  const proposed = session.proposal?.scope ?? [];
  const items = session.scope
    .map((path) =>
      proposed.includes(path)
        ? pathItem(path, "kept")
        : pathItem(path, "kept", "replaced the proposal"),
    )
    .join("");
  const added = session.scope.filter((path) => !proposed.includes(path));
  return (
    heading("Scope accepted") +
    `<ul class="paths">${items}</ul>` +
    statement(
      added.length === 0
        ? "Nothing was replaced: the accepted scope is the proposal."
        : `${plural(added.length, "path", "paths")} replaced what Prime offered. Drift is` +
          " measured against the accepted scope, never against the suggestion.",
    )
  );
}

/** What was written down before the agent ran. */
export function declaredPane(session: Session): string {
  if (session.scope.length === 0) {
    return (
      heading("What was declared") +
      statement("No scope declared. Nothing was written down before the agent ran.")
    );
  }
  const body =
    session.proposal === undefined
      ? pathList(session.scope, "kept")
      : proposalPane(session) + acceptedPane(session);
  return heading(`What was declared · ${plural(session.scope.length, "path", "paths")}`) + body;
}

/** What the diff says, with the paths nobody declared marked in it. */
export function changedPane(session: Session): string {
  const label = heading(`What changed · ${plural(session.reality.length, "path", "paths")}`);
  if (session.reality.length === 0) {
    return (
      label + statement("No files changed. The tree at stop matched the tree at start.")
    );
  }
  const items = session.reality
    .map((path) =>
      session.drift.includes(path) ? pathItem(path, "outside") : pathItem(path, "kept"),
    )
    .join("");
  const from = `Observed from git diff against ${session.startCommit}.`;
  return `${label}<ul class="paths">${items}</ul>${statement(from)}`;
}

/**
 * The paths that fell outside, named rather than only counted.
 *
 * Omitted where no scope was declared, the same rule the drift cell and the
 * pull request body follow: without a declaration there is no distance to
 * measure, and a block reporting none would claim there was.
 */
function noComparison(): string {
  return (
    `<div class="aside">` +
    statement(
      "No scope was declared, so no comparison is possible. Drift is reality minus" +
        " scope, and with nothing on the left of that subtraction no path here can be" +
        " called outside anything.",
    ) +
    "</div>"
  );
}

export function outsideBlock(session: Session): string {
  if (!hasDeclaredScope(session)) {
    return noComparison();
  }
  if (session.drift.length === 0) {
    return `<div class="aside">${statement("Nothing changed outside the declared scope.")}</div>`;
  }
  const title = `Outside the declared scope — ${session.drift.length} of ${session.reality.length} changed paths`;
  return (
    `<div class="outside">${heading(title)}` +
    `<ul class="paths">${session.drift.map((path) => pathItem(path, "outside")).join("")}</ul>` +
    "</div>"
  );
}

/** One labelled counter and the sentence that qualifies it. */
function counter(term: string, value: string, note: string, tone = "figure"): string {
  return (
    `<div class="counter"><dt>${escapeHtml(term)}</dt>` +
    `<dd><span class="big ${tone}">${escapeHtml(value)}</span>` +
    `<span class="qual">${escapeHtml(note)}</span></dd></div>`
  );
}

/** Money, and where there is none, which of the two reasons it is missing. */
function costCounter(session: Session, rates: RateTable): string {
  if (!wasMeasured(session.cost)) {
    const why = "No turns reached the record, so there is nothing to price. An absence of measurement, not a cost of zero.";
    return counter("Cost", "not captured", why, "quiet");
  }
  const price = priceSession(session.cost, rates);
  if (!isPriced(price)) {
    const why = `No rate for ${session.cost.model}. The token counters are complete; only the conversion to money is missing.`;
    return counter("Cost", "unpriced", why, "quiet");
  }
  return counter("Cost", formatUsd(price.usd), session.cost.model);
}

/**
 * Turns that produced nothing, or `unknown` where the record cannot say.
 *
 * Never a nought: a nought has the shape of a measurement and would say
 * nothing was wasted. `emptyTurnsOf` is the one place that decides which of
 * the two this is.
 */
function emptyCounter(session: Session): string {
  const empty = wasMeasured(session.cost) ? emptyTurnsOf(session) : undefined;
  if (empty === undefined) {
    const why = "A transcript names the tool a call used, never what it did to the disk, so this is answered from the diff — and the diff answers for the session, not for the turn.";
    return counter("Turns that changed no files", "unknown", why, "quiet");
  }
  const of = `of ${plural(session.cost.turns, "turn", "turns")}, settled against the diff at stop`;
  return counter("Turns that changed no files", figure(empty), of, empty > 0 ? "waste" : "quiet");
}

/** Turns and calls, kept as two counters. A call is not a turn. */
function workCounters(session: Session): string {
  if (!wasMeasured(session.cost)) {
    return (
      counter("Turns", "unknown", "No transcript reached the record.", "quiet") +
      counter("API calls", "unknown", "No transcript reached the record.", "quiet")
    );
  }
  return (
    counter("Turns", figure(session.cost.turns), "Prompts sent. One turn sets off one or more calls.") +
    counter("API calls", figure(session.cost.apiCalls), "Fragments sharing a request id, counted as one.")
  );
}

export function counterBlock(session: Session, rates: RateTable): string {
  return `<dl class="counters">${costCounter(session, rates)}${workCounters(session)}${emptyCounter(session)}</dl>`;
}

const TOKEN_LABELS: ReadonlyArray<[string, keyof Session["cost"]]> = [
  ["input", "inputTokens"],
  ["cache read", "cacheReadTokens"],
  ["cache creation", "cacheCreationTokens"],
  ["output", "outputTokens"],
];

/**
 * The four counters, never one sum. Each bills at a different rate, so a
 * total cannot be converted back into money.
 */
export function tokenBlock(session: Session): string {
  const cells = TOKEN_LABELS.map(
    ([label, key]) =>
      `<div class="token"><span class="k">${escapeHtml(label)}</span>` +
      `<span class="v">${escapeHtml(figure(session.cost[key] as number))}</span></div>`,
  ).join("");
  return (
    `<p class="pane-label">Tokens — four counters, never one sum</p>` +
    `<div class="tokens-grid">${cells}</div>`
  );
}

/** Every look at the repository, and which of them a person wrote. */
export function observationBlock(session: Session): string {
  const seen = observations(session);
  if (seen.length === 0) {
    return statement("No observation recorded yet. Nothing has looked for this work.");
  }
  const rows = seen
    .map(
      (seenOnce) =>
        `<li><span class="w">${escapeHtml(seenOnce.observedAt)}</span>` +
        `<span>${escapeHtml(seenOnce.outcome)}</span>` +
        `<span class="c">${escapeHtml(`${seenOnce.commit} · ${seenOnce.branch}`)}</span>` +
        `<span>${escapeHtml(seenOnce.source)}</span></li>`,
    )
    .join("");
  return `<p class="pane-label">Observations</p><ul class="obs">${rows}</ul>`;
}

/** The note under the intent, saying where the words came from. */
export function sourceNote(session: Session): string {
  const note = INTENT_NOTE[intentSourceOf(session)];
  const said = note === undefined ? "declared at session start, before the agent ran" : note;
  return statement(`Intent ${said}. Written once and never editable.`, "immutable");
}
