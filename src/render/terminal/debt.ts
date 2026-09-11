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
import { repoName } from "../../store.js";
import { day, figure, INDENT, note, padLeft, padRight, plural, width } from "./text.js";

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
export function formatDebt(report: DebtReport, palette: Palette, view: DebtView = {}): string[] {
  if (report.repos.length === 0) {
    return ["", ...note(NOTHING_RECORDED, (text) => text, view.limit)];
  }

  const lines = hereFirst(report.repos, view.here).flatMap((repo) => [
    "",
    ...repoLines(repo, palette, view),
  ]);
  return [...lines, ...footnotes(report, palette, view.limit)];
}

/** What the view knows beyond the report itself. */
export interface DebtView {
  /**
   * The repository the reader is standing in, as `repoIdentity` names it.
   * Absent outside a repo, and in the tests that only care about layout.
   */
  here?: string;
  /** Columns the prose may wrap at. Absent is no limit — see `terminalWidth`. */
  limit?: number;
}

/** What the current repo's heading says, so it can be found without counting. */
export const HERE = "(this repo)";

/**
 * The repository the reader is in, first; everything else in the order the
 * report came in.
 *
 * `debt` reads every log on the machine, which is what makes it worth running
 * — but the reader typed it somewhere, and that somewhere is the answer they
 * are most likely to have wanted. Scrolling past three other checkouts to
 * find it is a cost paid on every run.
 *
 * Only the current repo moves. Sorting the rest by how much each owes would
 * be a league table across repositories, which is exactly the aggregation
 * `debtOf` refuses to do; arriving at it by way of a sort in the view would
 * be the same claim made quietly.
 */
function hereFirst(repos: readonly RepoDebt[], here: string | undefined): RepoDebt[] {
  const mine = repos.filter((repo) => repo.repo === here);
  return [...mine, ...repos.filter((repo) => repo.repo !== here)];
}

/** What to say on a machine where nothing has ever been recorded. */
export const NOTHING_RECORDED =
  "No sessions recorded on this machine — nothing to judge. " +
  "Run session start before your agent.";

/** One repository: its name, then what its log was long enough to say. */
function repoLines(repo: RepoDebt, palette: Palette, view: DebtView): string[] {
  // Named, not keyed: `remote:` and `path:` are how the store tells two kinds
  // of identity apart, and neither is how anybody refers to a repository.
  const name = repoName(repo.repo);
  const heading = palette.meta(
    `${INDENT}${repo.repo === view.here ? `${name}  ${HERE}` : name}`,
  );

  // Absent, not empty: too little history to have found anything. Said as a
  // shortage of evidence, because that is what it is — a repo with two
  // sessions has no pattern to have, and printing "no debt" here would be an
  // all-clear nobody checked.
  if (!repo.files) {
    return [
      heading,
      ...note(
        `not enough history to judge — ` +
          `${plural(repo.history, "session", "sessions")} recorded, ${MIN_HISTORY} needed`,
        (text) => text,
        view.limit,
      ),
    ];
  }

  if (repo.files.length === 0) {
    return [heading, ...note(nothingOwed(repo), (text) => text, view.limit)];
  }

  return [heading, ...note(owed(repo), (text) => text, view.limit), "", ...table(repo.files, palette)];
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
function footnotes(report: DebtReport, palette: Palette, limit?: number): string[] {
  const files = report.repos.flatMap((repo) => repo.files ?? []);
  if (files.length === 0) {
    return [];
  }

  return [
    "",
    ...note(
      "cost is the whole of every session that touched the file, so the column does not add up",
      palette.meta,
      limit,
    ),
    ...note(`${IGNORED_CLASSES.join(", ")} files are never listed`, palette.meta, limit),
    ...unpricedLines(files, palette, limit),
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
function unpricedLines(
  files: readonly DebtFile[],
  palette: Palette,
  limit?: number,
): string[] {
  const models = [...new Set(files.flatMap((file) => file.spend.unpricedModels))].sort();
  if (models.length === 0) {
    return [];
  }

  return [
    ...note(
      `some of these sessions ran on models no rate covers: ` +
        `${models.join(", ")} — save this as ${RATES_HINT}`,
      palette.meta,
      limit,
    ),
    // Not wrapped: a stub is JSON the reader is meant to copy into a file.
    ...stubLines(models, palette),
  ];
}
