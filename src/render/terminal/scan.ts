// `session scan`: what the transcripts already on disk cost.
import { formatUsd, unpricedThroughout } from "../../pricing.js";
import { UNKNOWN_REPO, type ScanReport } from "../../scan.js";
import type { Palette } from "../palette.js";
import { NO_PRICE, RATES_HINT, stubLines } from "./cost.js";
import { figure, INDENT, label, padLeft, padRight, plural, width } from "./text.js";

// --- scan -----------------------------------------------------------------

/** The column heading of the repository table. */
const REPO_HEADINGS = ["repository", "sessions", "cost", "empty turns"] as const;

/**
 * What `session scan` found, in the order somebody reads it: what the window
 * cost, how much of that bought nothing, where it went, and which sessions
 * were the dearest.
 *
 * No colour role of its own. The money is left in the terminal's own colour
 * like everywhere else, the waste figure takes `waste` only when it is not
 * zero, prompts are `intent` because that is what they are, repository paths
 * are `path`, and the framing is `meta`. A report needing an eighth role
 * would be a report saying something the tool does not otherwise say.
 */
export function formatScan(report: ScanReport, palette: Palette): string[] {
  if (report.sessions === 0) {
    return ["", `${INDENT}No agent sessions in the last ${plural(report.days, "day", "days")}`];
  }

  return [
    "",
    palette.meta(`${INDENT}${scanWindow(report)}`),
    "",
    ...totalLines(report, palette),
    "",
    ...repoTable(report, palette),
    ...landedLines(report, palette),
    "",
    ...dearestLines(report, palette),
  ];
}

/** The one line that says what was read, before any figure computed from it. */
function scanWindow(report: ScanReport): string {
  return [
    `the last ${plural(report.days, "day", "days")}`,
    plural(report.sessions, "session", "sessions"),
    plural(report.repos.length, "repo", "repos"),
  ].join(" · ");
}

/**
 * The two figures the report leads with: what the window cost, and how much
 * of it went on turns that changed no files.
 *
 * A window nothing could be priced in says so instead of totalling to nought
 * — see `unpricedThroughout`. The waste line goes with it: a share of a total
 * that does not exist is not a figure either.
 */
function totalLines(report: ScanReport, palette: Palette): string[] {
  const { spend } = report;
  if (unpricedThroughout(spend)) {
    return [
      `${INDENT}${label("spent")}${NO_PRICE}`,
      ...unpricedScanLines(spend.unpriced, spend.unpricedModels, palette),
    ];
  }

  const waste = formatUsd(spend.emptyUsd);
  return [
    `${INDENT}${label("spent")}${formatUsd(spend.usd)}`,
    `${INDENT}${label("no edits")}${spend.emptyUsd > 0 ? palette.waste(waste) : waste}` +
      palette.meta(
        ` on ${figure(report.emptyTurns)} of ${plural(report.turns, "turn", "turns")}` +
          " that changed no files",
      ),
    ...(spend.unpriced > 0
      ? unpricedScanLines(spend.unpriced, spend.unpricedModels, palette)
      : []),
  ];
}

/** What could not be priced, and the whole file that would fix it. */
function unpricedScanLines(
  unpriced: number,
  models: readonly string[],
  palette: Palette,
): string[] {
  return [
    palette.meta(
      `${INDENT}${label("unpriced")}${plural(unpriced, "session", "sessions")} on ` +
        `${models.join(", ")} — save this as ${RATES_HINT}`,
    ),
    ...stubLines(models, palette),
  ];
}

/** The repository table: where the money went, and what produced nothing. */
function repoTable(report: ScanReport, palette: Palette): string[] {
  const rows = report.repos.map((row) => [
    row.repo === UNKNOWN_REPO ? "(no directory recorded)" : row.repo,
    figure(row.sessions),
    unpricedThroughout(row.spend) ? "unpriced" : formatUsd(row.spend.usd),
    figure(row.emptyTurns),
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
 * How many sessions were running while something reached the default branch.
 *
 * "Overlapped", never "merged". `outcome.ts` earns the word merged by finding
 * the blob a session left in the branch's history; this is two timestamps and
 * nothing else, and a report that called it merged would be claiming evidence
 * it does not have. Sessions in a checkout that could not be asked are named
 * rather than folded into the no's.
 */
function landedLines(report: ScanReport, palette: Palette): string[] {
  const asked = report.sessions - report.landingUnknown;
  if (asked === 0) {
    return [];
  }
  const unknown =
    report.landingUnknown > 0
      ? `; ${figure(report.landingUnknown)} in checkouts git could not be asked about`
      : "";
  return [
    palette.meta(
      `${INDENT}${figure(report.landed)} of ${plural(asked, "session", "sessions")} ` +
        `overlapped a commit landing on the default branch${unknown}`,
    ),
  ];
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
  const [repo = "", sessions = "", cost = "", empty = ""] = cells;
  return [
    ink(padRight(repo, widths[0] ?? 0)),
    padLeft(sessions, widths[1] ?? 0),
    padLeft(cost, widths[2] ?? 0),
    padLeft(empty, widths[3] ?? 0),
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
