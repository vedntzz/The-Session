// The estimate as `session estimate` prints it.
import { formatUsd, rateStub, USER_RATES_FILE } from "../pricing.js";
import {
  MIN_SESSIONS,
  type ClassSource,
  type Estimate,
  type EstimateFigures,
  type EstimateGroup,
} from "../estimate/figures.js";
import type { IntentSource } from "../store.js";

// --- the view ------------------------------------------------------------

export const LABEL_WIDTH = 10;

/** Where the note beside the class starts, so the two read as two columns. */
export const NOTE_COLUMN = 12;

export function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** How the class was arrived at, said out loud so a wrong one can be seen. */
export const SOURCES: Record<ClassSource, string> = {
  declared: "you said so",
  scope: "from --scope",
  intent: "from the intent",
};

export function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** What each group is, said once per block so the counts are not read as one. */
export const GROUPS: Record<IntentSource, string> = {
  declared: "intent written at session start",
  captured: "intent taken from the first prompt",
};

/** What a block says when the log holds none of that kind. */
export const NONE: Record<IntentSource, string> = {
  declared: "none — nothing like this was declared before it ran",
  captured: "none — the hook recorded nothing like this",
};

/**
 * One group's block: what it is made of, then what it came to.
 *
 * Printed even when it is empty. A block that disappears for want of sessions
 * would leave the other one looking like the whole answer, which is the pooled
 * reading this is here to prevent — and "no declared sessions like this" is
 * itself worth knowing, since it says the figures below come entirely from
 * work nobody wrote down in advance.
 */
export function formatGroup(group: EstimateGroup): string[] {
  if (group.matched === 0 && group.empty === 0) {
    return [line(group.source, NONE[group.source])];
  }

  const lines = sampleLines(group);
  const figures = group.figures;
  if (!figures) {
    // What was found, and nothing else. The alternative is a median of two,
    // which is the kind of number that ends up in a quote.
    lines.push(line("too few", `nothing is estimated from fewer than ${MIN_SESSIONS} sessions`));
    return lines;
  }

  lines.push(
    ...costLines(figures),
    mergedLine(figures),
    ...driftLines(figures, group),
    ...unpricedLines(figures),
    ...stubLines(figures),
  );
  return lines;
}

/**
 * The file that would price the rest, whole, under the line that said it
 * could not be.
 *
 * The reader has just been told the median is over part of the sample. What
 * they need next is not the name of a file they have never opened but the
 * contents of it, with the models already filled in — see `rateStub`.
 */
export function stubLines(figures: EstimateFigures): string[] {
  if (figures.unpriced === 0) {
    return [];
  }
  return rateStub(figures.unpricedModels)
    .split("\n")
    .map((text) => `  ${" ".repeat(LABEL_WIDTH)}${text}`);
}

/**
 * What the block is made of.
 *
 * The sessions that changed no files are named beside the sample, not after
 * the figures: that line says what the sample is not, and it belongs where the
 * reader is deciding how much to believe it.
 */
export function sampleLines(group: EstimateGroup): string[] {
  const sample = plural(group.matched, "session", "sessions");
  const lines = [line(group.source, `${sample.padEnd(NOTE_COLUMN)}${GROUPS[group.source]}`)];
  if (group.empty > 0) {
    lines.push(
      line(
        "left out",
        `${plural(group.empty, "session", "sessions")} changed no files — nothing ` +
          `was attempted, so there is nothing to estimate from`,
      ),
    );
  }
  return lines;
}

/** The median and the p90, or the admission that nothing here has a rate. */
export function costLines(figures: EstimateFigures): string[] {
  if (figures.priced === 0) {
    return [line("cost", `no price for any of these models — see ${USER_RATES_FILE}`)];
  }
  return [line("median", formatUsd(figures.median)), line("p90", formatUsd(figures.p90))];
}

/** How often these merged the first time anybody looked. */
export function mergedLine(figures: EstimateFigures): string {
  if (figures.decided === 0) {
    return line("merged", `nothing has been settled yet, so there is no rate to give`);
  }
  const rate = percent(figures.mergedFirstTime, figures.decided);
  const still = figures.open > 0 ? `, ${figures.open} still open` : "";
  const found = `${figures.mergedFirstTime} of ${figures.decided} first time (${rate})${still}`;
  return line("merged", found);
}

/**
 * The paths that kept turning up, under a column of their own so a list of
 * five can be read down rather than across. Only the first line carries the
 * label.
 *
 * Counted over this group alone, which is the whole of why the denominator is
 * finally a plain one: every session behind the declared block declared a
 * scope, so "3 of 9" is three of the nine that could have drifted.
 *
 * A captured block says outright that there was nothing to drift from rather
 * than printing no line at all. A reader comparing it against the declared
 * block above would otherwise read the silence as these sessions never having
 * drifted.
 */
export function driftLines(figures: EstimateFigures, group: EstimateGroup): string[] {
  if (figures.drift.length === 0 && group.source === "captured") {
    return [line("drift", "nothing was declared to drift from, so none is counted")];
  }
  const width = figures.drift.reduce((widest, entry) => Math.max(widest, entry.path.length), 0);
  return figures.drift.map((entry, index) => {
    const count = `${entry.sessions} of ${group.matched}`;
    return line(index === 0 ? "drift" : "", `${entry.path.padEnd(width + 2)}${count}`);
  });
}

/** Said out loud, because the figures above are over the rest. */
export function unpricedLines(figures: EstimateFigures): string[] {
  if (figures.unpriced === 0) {
    return [];
  }
  return [
    line(
      "unpriced",
      `${plural(figures.unpriced, "session", "sessions")} ran on a model with no rate; ` +
        `the money above is the other ${figures.priced}`,
    ),
  ];
}

/**
 * The estimate as `session estimate` prints it: the question, then one block
 * per intent source.
 *
 * Two blocks, never a total. The sample comes before the figures inside each,
 * in that order on purpose: what the numbers are made of decides how much to
 * believe them, and a median with no count beside it is a number pretending to
 * be an answer.
 *
 * Declared first because it is the stronger evidence — somebody said what they
 * were going to do before the agent ran — not because it is the larger sample.
 * On most logs it is the smaller one.
 */
export function formatEstimate(estimate: Estimate): string[] {
  const lines = [
    "",
    line("estimate", estimate.intent),
    line("class", `${estimate.class.padEnd(NOTE_COLUMN)}${SOURCES[estimate.source]}`),
  ];

  // On its own line rather than beside each sample: the window is one fact
  // about the question, and printing it twice would suggest the two blocks
  // could have been cut at different dates.
  if (estimate.since !== undefined) {
    lines.push(line("since", estimate.since));
  }

  const groups = [estimate.declared, estimate.captured];
  for (const group of groups) {
    lines.push("", ...formatGroup(group));
  }

  // Once, at the end, and only when something was thin. It is advice about the
  // question rather than about either block — widening the window or naming a
  // different class changes both — so repeating it under each would read as
  // two separate problems.
  if (groups.some((group) => group.figures === undefined && group.matched > 0)) {
    lines.push("", line("", "widen --since, or say --class if these were the wrong ones"));
  }

  return lines;
}
