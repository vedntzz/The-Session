// `session scan`: what the transcripts already on disk did, and then what
// they cost.
import { formatUsd, unpricedThroughout } from "../../pricing.js";
import { UNKNOWN_REPO, type ScanReport } from "../../scan.js";
import type { Palette } from "../palette.js";
import { NO_PRICE, RATES_HINT, stubLines } from "./cost.js";
import { figure, INDENT, padLeft, padRight, plural, width } from "./text.js";

// --- scan -----------------------------------------------------------------

/**
 * The column headings of the repository table, and with them the column order.
 * Cost is the last column rather than the middle one: the turns that changed
 * no files are what the table is read for, and the money is the figure the
 * footnote under it carries.
 */
const REPO_HEADINGS = ["repository", "sessions", "turns", "cost"] as const;

/**
 * What `session scan` found, in the order somebody reads it: how many sessions
 * ran while something landed, how many turns produced nothing, where the work
 * was, which sessions were the dearest, and — last and dim — what the window
 * cost.
 *
 * No colour role of its own. The headline is left in the terminal's own colour
 * because it is always there and always the first thing read, prompts are
 * `intent` because that is what they are, repository paths are `path`, and the
 * framing is `meta`. A report needing an eighth role would be a report saying
 * something the tool does not otherwise say.
 */
export function formatScan(report: ScanReport, palette: Palette): string[] {
  if (report.sessions === 0) {
    return ["", `${INDENT}No agent sessions in the last ${plural(report.days, "day", "days")}`];
  }

  return [
    "",
    ...landedLines(report, palette),
    palette.meta(`${INDENT}${scanWindow(report)}`),
    ...section(emptyTurnLines(report, palette)),
    ...section(repoTable(report, palette)),
    ...section(dearestLines(report, palette)),
    ...section(totalLines(report, palette)),
  ];
}

/** A block of the report, with the blank line that separates it from the last. */
function section(lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ["", ...lines];
}

/** What was read, under the headline computed from it. */
function scanWindow(report: ScanReport): string {
  return `the last ${plural(report.days, "day", "days")} · ${plural(report.repos.length, "repo", "repos")}`;
}

/**
 * That this report has no figure for turns that changed no files, and why.
 *
 * `scan` reads transcripts and nothing else. Whether a turn produced anything
 * is settled against the diff a session left, and a transcript is not a
 * checkout — `scan` has no `session start` to have recorded a base commit, so
 * there is no diff to reconcile against and no honest figure to print. It is
 * the same refusal that keeps the word `merged` out of this report: overlapping
 * a commit in time is not landing, and calling a turn empty because it used no
 * tool named `Edit` is not measuring what it produced.
 *
 * Said rather than left out. A report that silently dropped the line would
 * read as a window in which nothing was wasted, and the reader would have no
 * way to tell that from a window nobody measured.
 */
function emptyTurnLines(report: ScanReport, palette: Palette): string[] {
  if (report.turns === 0) {
    return [];
  }
  return [
    palette.meta(
      `${INDENT}${plural(report.turns, "turn", "turns")} · which of them changed no files ` +
        "is not something a transcript can say — run session start to have a diff to measure against",
    ),
  ];
}

/**
 * What the window cost, as a footnote and nothing more.
 *
 * Dim, and last. The agents measure their own cost now; what this command
 * knows that they do not is which sessions ran while work reached the default
 * branch and how many turns produced nothing, and those are the lines above.
 *
 * The waste share stays dim with the rest of the line rather than taking the
 * `waste` ink. Red inside a footnote would make the footnote the loudest thing
 * on the page, which is the arrangement this ordering exists to undo.
 *
 * A window nothing could be priced in says so instead of totalling to nought —
 * see `unpricedThroughout`. The waste share goes with it: a share of a total
 * that does not exist is not a figure either.
 */
function totalLines(report: ScanReport, palette: Palette): string[] {
  const { spend } = report;
  if (unpricedThroughout(spend)) {
    return [
      palette.meta(`${INDENT}${NO_PRICE} spent: nothing here could be priced`),
      ...unpricedScanLines(spend.unpriced, spend.unpricedModels, palette),
    ];
  }

  return [
    // What it cost, and no share of it on turns that changed no files: which
    // turns those were is settled against a diff, and a scan has none.
    palette.meta(`${INDENT}${formatUsd(spend.usd)} spent`),
    ...(spend.unpriced > 0
      ? unpricedScanLines(spend.unpriced, spend.unpricedModels, palette)
      : []),
  ];
}

/**
 * What could not be priced, and the whole file that would fix it.
 *
 * Worded as `week` words it. The label column it used to sit in went with the
 * two figures that used to head this report, and one line of prose under the
 * footnote is the right shape for a note about the footnote.
 */
function unpricedScanLines(
  unpriced: number,
  models: readonly string[],
  palette: Palette,
): string[] {
  return [
    palette.meta(
      `${INDENT}${plural(unpriced, "session", "sessions")} unpriced: ` +
        `${models.join(", ")} — save this as ${RATES_HINT}`,
    ),
    ...stubLines(models, palette),
  ];
}

/** The repository table: where the work was, what produced nothing, what it cost. */
function repoTable(report: ScanReport, palette: Palette): string[] {
  const rows = report.repos.map((row) => [
    row.repo === UNKNOWN_REPO ? "(no directory recorded)" : row.repo,
    figure(row.sessions),
    figure(row.turns),
    unpricedThroughout(row.spend) ? "unpriced" : formatUsd(row.spend.usd),
  ]);
  const widths = columnWidths([[...REPO_HEADINGS], ...rows]);

  return [
    palette.meta(`${INDENT}${repoRow([...REPO_HEADINGS], widths)}`),
    ...rows.map((cells, index) =>
      repoRow(cells, widths, (text) =>
        report.repos[index]?.repo === UNKNOWN_REPO ? palette.meta(text) : palette.path(text),
      ).replace(/^/, INDENT),
    ),
  ];
}

/**
 * The headline: how many sessions, and how many of them were running while
 * something reached the default branch.
 *
 * "Ran while something landed", never "merged", and never "shipped".
 * `outcome.ts` earns the word merged by finding the blob a session left in the
 * branch's history; this is two timestamps and nothing else. Saying it as a
 * coincidence in time is the whole of what the evidence supports, and it is
 * plainer English than the "overlapped a commit" this line used to read —
 * which was accurate and which nobody could parse at a glance.
 *
 * Sessions in a checkout that could not be asked get a line of their own
 * rather than being folded into the no's: not knowing where work went is not
 * the same as knowing it went nowhere. A window where none could be asked
 * still leads with how many sessions there were, since that much is known.
 */
function landedLines(report: ScanReport, palette: Palette): string[] {
  const sessions = plural(report.sessions, "session", "sessions");
  const asked = report.sessions - report.landingUnknown;
  const unknown = unknownLines(report.landingUnknown, palette);
  if (asked === 0) {
    return [`${INDENT}${sessions}`, ...unknown];
  }
  return [
    `${INDENT}${sessions} · ${figure(report.landed)} ran while something landed on the ` +
      `default branch · ${figure(asked - report.landed)} did not`,
    ...unknown,
  ];
}

/** The checkouts that could not answer, counted apart from the ones that said no. */
function unknownLines(unknown: number, palette: Palette): string[] {
  if (unknown === 0) {
    return [];
  }
  const where = unknown === 1 ? "a checkout" : "checkouts";
  return [palette.meta(`${INDENT}${figure(unknown)} in ${where} git could not be asked about`)];
}

/** The widest cell in each column, so the table sizes to its contents. */
function columnWidths(rows: readonly (readonly string[])[]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, width(cell));
    });
  }
  return widths;
}

/** One row: the path left, the three figures right, so digits line up. */
function repoRow(
  cells: readonly string[],
  widths: readonly number[],
  ink: (text: string) => string = (text) => text,
): string {
  const [repo = "", sessions = "", empty = "", cost = ""] = cells;
  return [
    ink(padRight(repo, widths[0] ?? 0)),
    padLeft(sessions, widths[1] ?? 0),
    padLeft(empty, widths[2] ?? 0),
    padLeft(cost, widths[3] ?? 0),
  ].join("  ");
}

/**
 * The dearest sessions, named by what was asked of them.
 *
 * The prompt is the label because it is the only thing a transcript says about
 * what the session was for — nothing was declared, so there is no intent to
 * quote. It is truncated to one line: a prompt runs to paragraphs, and a
 * report that wrapped three of them would bury the figures beside them.
 */
function dearestLines(report: ScanReport, palette: Palette): string[] {
  if (report.top.length === 0) {
    return [
      palette.meta(
        `${INDENT}No session could be priced, so none can be called the dearest.`,
      ),
    ];
  }

  const heading = plural(report.top.length, "dearest session", "dearest sessions");
  return [
    palette.meta(`${INDENT}${heading}`),
    ...report.top.map((top) => dearestRow(top, palette)),
    ...unrankableLines(report.unrankable, palette),
  ];
}

/** The money right, so three of them line up on the point; the prompt left. */
function dearestRow(top: ScanReport["top"][number], palette: Palette): string {
  return (
    `${INDENT}${padLeft(formatUsd(top.usd), 9)}  ` + palette.intent(oneLine(top.session.label))
  );
}

/** Said out loud: three dearest out of a set that could not all be priced is not three dearest. */
function unrankableLines(unrankable: number, palette: Palette): string[] {
  if (unrankable === 0) {
    return [];
  }
  return [
    palette.meta(
      `${INDENT}${plural(unrankable, "session", "sessions")} could not be ` +
        "ranked, having no rate to be dear by",
    ),
  ];
}

/** How wide a prompt may be before the figures beside it stop lining up. */
const LABEL_WIDTH_MAX = 56;

/**
 * A prompt as one line of a report. Newlines close up — a prompt is often a
 * paragraph, and a row that ended halfway down the terminal would take the
 * column headings with it.
 */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return width(flat) <= LABEL_WIDTH_MAX
    ? flat
    : `${[...flat].slice(0, LABEL_WIDTH_MAX - 1).join("")}…`;
}
