// `session survival`: how much of what merged is still there.
import { MIN_SESSIONS } from "../../estimate/figures.js";
import type { Checked, CheckResult } from "../../commands/survival.js";
import {
  CHECK_GRACE_DAYS,
  countFates,
  meetsBenchmark,
  SURVIVAL_BENCHMARK,
  type SurvivalReport,
  type SurvivalSample,
  type WindowReport,
} from "../../survival.js";
import type { Palette } from "../palette.js";
import { figure, INDENT, padRight, percent, plural, width } from "./text.js";

/**
 * What `session survival` prints.
 *
 * One block per window, and inside each the same three cuts every time: the
 * whole of it, then by class, then declared against captured. The order is the
 * house one — what happened to the work first, the qualifications under it —
 * and there is no money in this view at all, because none of these questions
 * is about money.
 *
 * Declared and captured are two lines, never a total. Same rule as `estimate`,
 * for the same reason: a commitment made before the work and a transcript of a
 * prompt are different evidence, and a pooled figure describes neither while
 * moving whenever the mix moves.
 *
 * Colour does one thing here: `merged` on a rate that meets the benchmark,
 * `drift` on one that does not. Both are figures the reader is being asked to
 * judge against a line, and which side of the line is the whole of what the
 * ink says. Everything else is `meta`, and every rate reads correctly with the
 * escapes stripped out.
 */
export function formatSurvival(report: SurvivalReport, palette: Palette): string[] {
  if (report.sessions === 0) {
    return ["", `${INDENT}${NOTHING_MERGED}`];
  }

  return [
    "",
    `${INDENT}${headline(report)}`,
    palette.meta(`${INDENT}${BENCHMARK_NOTE}`),
    ...report.windows.flatMap((window) => ["", ...windowLines(window, palette)]),
    ...dueLines(report, palette),
    ...unsettledLines(report, palette),
  ];
}

/** What to say where nothing has merged yet — there is nothing to have survived. */
export const NOTHING_MERGED =
  "No merged sessions yet, so there is nothing to have survived. " +
  "Run session settle once work has landed.";

/** Where the 90% comes from, said once so no rate line has to carry it. */
export const BENCHMARK_NOTE =
  `measured against the published benchmark: above ${Math.round(SURVIVAL_BENCHMARK * 100)}% ` +
  `of what merged still there, below ${Math.round((1 - SURVIVAL_BENCHMARK) * 100)}% churned`;

/** How many merged sessions this is drawn from, before any of it is cut up. */
function headline(report: SurvivalReport): string {
  return `${plural(report.sessions, "merged session", "merged sessions")} · what is still there`;
}

/** Width of the label column, sized to the longest label the layout uses. */
const LABEL = 10;

function line(label: string, value: string): string {
  return `${INDENT}${padRight(label, LABEL)}${value}`;
}

/** One window: the whole of it, then the two ways it is cut. */
function windowLines(report: WindowReport, palette: Palette): string[] {
  const heading = `${report.window} days`;
  const overall = report.overall;

  return [
    line(heading, rateText(overall, palette)),
    ...noteLines(overall, palette),
    ...classLines(report, palette),
    ...sourceLines(report, palette),
  ];
}

/**
 * A group's headline figure: the rate, or why there is not one.
 *
 * A sample under the floor says how many sessions it has and stops. A rate
 * over two sessions is a number that looks like knowledge and is not — the
 * same floor `estimate` prints its sample under, and the same reason.
 */
function rateText(sample: SurvivalSample, palette: Palette): string {
  const { figures } = sample;
  if (!figures) {
    return tooFew(sample);
  }

  const rate = percent(figures.rate);
  const ink = meetsBenchmark(figures.rate) ? palette.merged : palette.drift;
  return (
    `${ink(rate)} of ${plural(figures.paths, "file", "files")} still there · ` +
    `${plural(sample.measured, "session", "sessions")}`
  );
}

/**
 * What a group says instead of a rate: every state it has sessions in.
 *
 * All of them, not the largest — a group of three measured and two due is two
 * different facts, and a row that named only the first would hide the one the
 * reader can act on. A blank where a figure would go reads as nought, and none
 * of these is nought.
 */
function tooFew(sample: SurvivalSample): string {
  const parts: string[] = [];
  if (sample.measured > 0) {
    parts.push(
      `${plural(sample.measured, "session", "sessions")} measured — ` +
        `fewer than ${MIN_SESSIONS}, so no rate`,
    );
  }
  parts.push(...outstandingParts(sample));
  return parts.length > 0 ? parts.join(" · ") : "nothing merged this long ago";
}

/**
 * Where the reader sits against the benchmark, and what the rate leaves out.
 *
 * The verdict is a sentence rather than a symbol: this is a figure somebody
 * will quote, and "above" and "below" are the two things they will quote it
 * as. Churn is printed beside it because the benchmark is published from both
 * ends, and a reader who knows it as the 10% figure should not have to
 * subtract.
 *
 * Only under a rate. Where there is none, the line above has already said
 * which states the sessions are in, and saying it twice would read as two
 * different counts.
 */
function noteLines(sample: SurvivalSample, palette: Palette): string[] {
  const { figures } = sample;
  if (!figures) {
    return [];
  }

  const verdict = meetsBenchmark(figures.rate) ? "above" : "below";
  const lines = [
    line(
      "",
      palette.meta(
        `${verdict} the ${percent(SURVIVAL_BENCHMARK)} benchmark · ` +
          `${percent(figures.churn)} churn · ` +
          `${figure(figures.rewritten)} rewritten, ${figure(figures.deleted)} deleted`,
      ),
    ),
  ];

  const outstanding = outstandingParts(sample);
  if (outstanding.length > 0) {
    lines.push(line("", palette.meta(outstanding.join(" · "))));
  }
  return lines;
}

/**
 * The sessions no rate covers, and why each is not in one.
 *
 * `pending` is the important one and it is never a failure: a session merged
 * the day before yesterday has not failed to survive a fortnight, and folding
 * it into the rate would report the calendar as churn. `due` is actionable;
 * `missed` is not, and says so rather than pretending otherwise.
 */
function outstandingParts(sample: SurvivalSample): string[] {
  const parts: string[] = [];
  if (sample.pending > 0) {
    parts.push(`${figure(sample.pending)} still inside the window`);
  }
  if (sample.due > 0) {
    parts.push(`${figure(sample.due)} due a check`);
  }
  if (sample.missed > 0) {
    parts.push(`${figure(sample.missed)} past answering`);
  }
  return parts;
}

/** One row per class that has a session in it, in the class table's order. */
function classLines(report: WindowReport, palette: Palette): string[] {
  if (report.byClass.length === 0) {
    return [];
  }

  const column = report.byClass.reduce((widest, row) => Math.max(widest, width(row.class)), 0);
  return report.byClass.map((row, index) =>
    line(
      index === 0 ? "class" : "",
      `${padRight(row.class, column + 2)}${rateText(row.sample, palette)}`,
    ),
  );
}

/**
 * Declared and captured, one line each and never a total.
 *
 * Both printed even when one holds nothing: a block that vanished for want of
 * sessions would leave the other reading as the whole answer, which is the
 * pooling this split exists to prevent.
 */
function sourceLines(report: WindowReport, palette: Palette): string[] {
  return [
    line("declared", rateText(report.declared, palette)),
    line("captured", rateText(report.captured, palette)),
  ];
}

/**
 * The one thing to type, said once at the bottom rather than beside every
 * count that prompted it.
 *
 * A check is only answerable for about a week after its window closes, so a
 * report that mentioned it in passing would be one that let the answer expire.
 * It counts windows, not sessions: one session can owe both.
 */
function dueLines(report: SurvivalReport, palette: Palette): string[] {
  const due = report.windows.reduce((total, window) => total + window.overall.due, 0);
  if (due === 0) {
    return [];
  }
  const text =
    `${padRight("due", LABEL)}${plural(due, "check", "checks")} can still be made — ` +
    `run session survival --check`;
  return ["", `${INDENT}${palette.meta(text)}`];
}

/** The merged sessions no window can be placed for, and what fixes that. */
function unsettledLines(report: SurvivalReport, palette: Palette): string[] {
  if (report.unsettled === 0) {
    return [];
  }
  const text =
    `${padRight("unsettled", LABEL)}${plural(report.unsettled, "session", "sessions")} ` +
    `merged with no record of when — run session settle to date them`;
  return ["", `${INDENT}${palette.meta(text)}`];
}


// --- the check ------------------------------------------------------------

/**
 * What `session survival --check` prints: what it wrote, and what it did not.
 *
 * One line per check written, because each is a record appended to the log and
 * a command that writes to the log says what it wrote. The three counters
 * under it are the windows nothing was written for, each with the reason: too
 * soon, too late, or no merge date to count from.
 */
export function formatCheck(result: CheckResult, palette: Palette): string[] {
  if (!result.branch) {
    return [
      "",
      `${INDENT}${NO_BRANCH}`,
    ];
  }

  return [
    "",
    line("branch", result.branch),
    ...result.checked.map((checked) => checkedLine(checked, palette)),
    line(
      "checked",
      `${plural(result.checked.length, "check", "checks")} recorded`,
    ),
    ...skippedLines(result, palette),
  ];
}

/** What to say where there is no default branch to check anything against. */
export const NO_BRANCH =
  "No default branch found — looked for origin/HEAD, main, master. " +
  "There is nothing to check what merged against.";

/** One check: which session, which window, and what it found. */
function checkedLine(checked: Checked, palette: Palette): string {
  const counts = countFates(checked.observation);
  const rate = counts.paths === 0 ? undefined : counts.survived / counts.paths;
  const said =
    rate === undefined
      ? "no paths to check"
      : `${(meetsBenchmark(rate) ? palette.merged : palette.drift)(percent(rate))} of ` +
        `${plural(counts.paths, "file", "files")} still there`;

  return line(
    checked.session.id.slice(0, 8),
    `${padRight(`${checked.window} days`, 10)}${said}`,
  );
}

/** The windows nothing was written for, each said as the reason it was not. */
function skippedLines(result: CheckResult, palette: Palette): string[] {
  const lines: string[] = [];
  if (result.pending > 0) {
    lines.push(
      line("pending", palette.meta(`${figure(result.pending)} still inside their window`)),
    );
  }
  if (result.missed > 0) {
    lines.push(
      line(
        "missed",
        palette.meta(
          `${figure(result.missed)} closed more than ${CHECK_GRACE_DAYS} days ago — the ` +
            `branch now is not evidence about then`,
        ),
      ),
    );
  }
  if (result.unsettled > 0) {
    lines.push(
      line(
        "unsettled",
        palette.meta(
          `${plural(result.unsettled, "session", "sessions")} merged with no record of ` +
            `when — run session settle to date them`,
        ),
      ),
    );
  }
  return lines;
}
