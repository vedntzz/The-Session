// `session debt`: the files work keeps landing in that nobody plans for.
import {
  IGNORED_CLASSES,
  MIN_DRIFTS,
  MIN_HISTORY,
  type DebtFile,
  type DebtReport,
  type RepoDebt,
} from "../../debt.js";
import { formatUsd, unpricedThroughout } from "../../pricing.js";
import type { Palette } from "../palette.js";
import { NO_PRICE, RATES_HINT, stubLines } from "./cost.js";
import { day, figure, INDENT, padLeft, padRight, plural, width } from "./text.js";

/**
 * The column headings, and with them the column order.
 *
 * The file first, then how often work landed in it, then when, then what those
 * sessions cost — drift before money, like every other view. The count carries
 * its unit for the reason `week`'s `drift files` does: a bare `sessions` over a
 * column of small integers would be read as the repo's history rather than as
 * the number of times this file went outside a plan.
 */
const HEADINGS = ["file", "sessions drifted", "last touched", "cost"] as const;

/**
 * What `session debt` found, one repository at a time.
 *
 * Never a total, and never a figure spanning repos: the report is a list of
 * separate answers that happen to be printed together. The cost column does
 * not add up either — a session that drifted onto four files is in four rows —
 * and the note under the table says so rather than leaving the reader to sum a
 * column that would lie.
 *
 * No colour role of its own. The paths are `drift`, because that is what they
 * are and it is the same red `show` and `week` mark drift in; repo names and
 * every figure's framing are `meta`; the money is left in the terminal's own
 * colour, like every other cost cell.
 */
export function formatDebt(report: DebtReport, palette: Palette): string[] {
  if (report.repos.length === 0) {
    return ["", `${INDENT}${NOTHING_RECORDED}`];
  }

  const lines = report.repos.flatMap((repo) => ["", ...repoLines(repo, palette)]);
  return [...lines, ...footnotes(report, palette)];
}

/** What to say on a machine where nothing has ever been recorded. */
export const NOTHING_RECORDED =
  "No sessions recorded on this machine — nothing to judge. " +
  "Run session start before your agent.";

/** One repository: its name, then what its log was long enough to say. */
function repoLines(repo: RepoDebt, palette: Palette): string[] {
  const heading = palette.meta(`${INDENT}${repo.repo}`);

  // Absent, not empty: too little history to have found anything. Said as a
  // shortage of evidence, because that is what it is — a repo with two
  // sessions has no pattern to have, and printing "no debt" here would be an
  // all-clear nobody checked.
  if (!repo.files) {
    return [
      heading,
      `${INDENT}not enough history to judge — ` +
        `${plural(repo.history, "session", "sessions")} recorded, ${MIN_HISTORY} needed`,
    ];
  }

  if (repo.files.length === 0) {
    return [heading, `${INDENT}${nothingOwed(repo)}`];
  }

  return [heading, `${INDENT}${owed(repo)}`, "", ...table(repo.files, palette)];
}

/** The finding: how many files, out of how much history. */
function owed(repo: RepoDebt): string {
  return (
    `${plural(repo.files?.length ?? 0, "file", "files")} drifted into ` +
    `${MIN_DRIFTS} or more times and never declared since · ` +
    `${plural(repo.history, "session", "sessions")} of history`
  );
}

/**
 * The all-clear. It names the test it passed, so it cannot be read as "no
 * drift" — plenty of files may have drifted once or twice, and one that was
 * later declared has left this list on purpose.
 */
function nothingOwed(repo: RepoDebt): string {
  return (
    `no file drifted into ${MIN_DRIFTS} or more times without being declared since · ` +
    `${plural(repo.history, "session", "sessions")} of history`
  );
}

/** The table: path left, the three figures right, so the columns can be scanned. */
function table(files: readonly DebtFile[], palette: Palette): string[] {
  const rows = files.map((file) => [
    file.path,
    figure(file.sessions),
    day(file.lastTouched),
    costCell(file),
  ]);
  const widths = columnWidths([[...HEADINGS], ...rows]);

  return [
    palette.meta(`${INDENT}${row([...HEADINGS], widths)}`),
    ...rows.map((cells) => `${INDENT}${row(cells, widths, palette.drift)}`),
  ];
}

/**
 * What the sessions that drifted onto this file cost.
 *
 * A file whose sessions could none of them be priced says so rather than
 * totalling to nought — nought is a claim that they were free, and what
 * happened is that nobody knows. See `unpricedThroughout`.
 */
function costCell(file: DebtFile): string {
  return unpricedThroughout(file.spend) ? NO_PRICE : formatUsd(file.spend.usd);
}

/** The widest cell in each column, so the table sizes to its contents. */
function columnWidths(rows: readonly (readonly string[])[]): number[] {
  const widths: number[] = [];
  for (const cells of rows) {
    cells.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, width(cell));
    });
  }
  return widths;
}

/** One row, trimmed rather than padded so no line ends in trailing spaces. */
function row(
  cells: readonly string[],
  widths: readonly number[],
  ink: (text: string) => string = (text) => text,
): string {
  const [file = "", sessions = "", touched = "", cost = ""] = cells;
  return [
    ink(padRight(file, widths[0] ?? 0)),
    padLeft(sessions, widths[1] ?? 0),
    padLeft(touched, widths[2] ?? 0),
    padLeft(cost, widths[3] ?? 0),
  ]
    .join("  ")
    .trimEnd();
}

/**
 * The two things the tables above cannot say for themselves: what the cost
 * column is, and which files were never eligible.
 *
 * Printed once, under everything, and only when something was listed. A
 * legend for an empty report is a line the reader has to check the report
 * against to find out it says nothing.
 */
function footnotes(report: DebtReport, palette: Palette): string[] {
  const files = report.repos.flatMap((repo) => repo.files ?? []);
  if (files.length === 0) {
    return [];
  }

  return [
    "",
    palette.meta(
      `${INDENT}cost is the whole of every session that touched the file, so the ` +
        "column does not add up",
    ),
    palette.meta(`${INDENT}${IGNORED_CLASSES.join(", ")} files are never listed`),
    ...unpricedLines(files, palette),
  ];
}

/**
 * The models nothing could price, and the whole file that would fix them.
 *
 * No count in front of them. One session can sit behind several rows, so
 * counting the unpriced ones across the report would be counting the same
 * session twice — and a count that overstates is worse here than no count,
 * since the reader's next move is the same either way.
 */
function unpricedLines(files: readonly DebtFile[], palette: Palette): string[] {
  const models = [...new Set(files.flatMap((file) => file.spend.unpricedModels))].sort();
  if (models.length === 0) {
    return [];
  }

  return [
    palette.meta(
      `${INDENT}some of these sessions ran on models no rate covers: ` +
        `${models.join(", ")} — save this as ${RATES_HINT}`,
    ),
    ...stubLines(models, palette),
  ];
}
