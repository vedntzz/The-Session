// `session cochange`: the files that keep moving together.
import {
  MIN_RATE,
  MIN_TOGETHER,
  type CoChangePair,
  type CoChangeReport,
  type RepoCoChange,
} from "../../cochange.js";
import { IGNORED_CLASSES, MIN_HISTORY } from "../../debt.js";
import type { Palette } from "../palette.js";
import { figure, INDENT, padLeft, padRight, percent, plural, width } from "./text.js";

/**
 * The column headings, and with them the column order.
 *
 * The pair first, both halves of it, then how many sessions moved them
 * together, then how reliably. Count before strength because the count is the
 * evidence and the strength is the claim read off it — a reader who distrusts
 * the second wants to see the first without moving their eye back.
 *
 * `moves with` rather than a second `file`: the two columns hold the same kind
 * of thing, and a heading that said so twice would leave the reader looking
 * for the difference between them. There is none — the pair is unordered, and
 * the left column is just the path that sorts first.
 */
const HEADINGS = ["file", "moves with", "sessions together", "strength"] as const;

/**
 * What `session cochange` found, one repository at a time.
 *
 * Never a total and never a figure spanning repos — the same file name in two
 * codebases is two files. Like `debt`, this is a list of separate answers that
 * happen to be printed together.
 *
 * No colour role of its own, and no money in the view at all. Paths are
 * `path`, which is what they are: these went where the work went, and nothing
 * here says anything about whether they were declared. Framing is `meta`.
 */
export function formatCochange(report: CoChangeReport, palette: Palette): string[] {
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
function repoLines(repo: RepoCoChange, palette: Palette): string[] {
  const heading = palette.meta(`${INDENT}${repo.repo}`);

  // Absent, not empty: too little history to have looked. The same sentence
  // `debt` prints, because it is the same shortage — a repo with two sessions
  // has no pattern to have, and "no pairs" here would be an all-clear nobody
  // checked.
  if (!repo.pairs) {
    return [
      heading,
      `${INDENT}not enough history to judge — ` +
        `${plural(repo.history, "session", "sessions")} recorded, ${MIN_HISTORY} needed`,
    ];
  }

  if (repo.pairs.length === 0) {
    return [heading, `${INDENT}${nothingPaired(repo)}`];
  }

  return [
    heading,
    `${INDENT}${paired(repo)}`,
    `${INDENT}${checked(repo)}`,
    "",
    ...table(repo.pairs, palette),
  ];
}

/**
 * Whether the pairs below were held against a branch tip, and which.
 *
 * Always printed, in both directions, and that is the point of it. The marks
 * in the table are only worth reading if the reader knows a look was taken —
 * an unmarked row under a repo nobody could ask says nothing about whether the
 * files are there, and without this line it would read as though it did. The
 * log names repositories, and most of them are not the checkout somebody
 * happens to be standing in.
 */
function checked(repo: RepoCoChange): string {
  return repo.branch === undefined
    ? `not checked against a branch tip, so nothing here is marked ${GONE}`
    : `checked against ${repo.branch}`;
}

/** The finding: how many pairs, out of how much history. */
function paired(repo: RepoCoChange): string {
  return (
    `${plural(repo.pairs?.length ?? 0, "pair", "pairs")} moved together in ` +
    `${MIN_TOGETHER} or more sessions, ${percent(MIN_RATE)} of the time or more · ` +
    `${plural(repo.history, "session", "sessions")} of history`
  );
}

/**
 * The all-clear. It names the test that was passed, so it cannot be read as
 * "nothing here ever changes together" — plenty of files will have moved
 * together once or twice, and a pair one of whose halves changes with
 * everything is below the bar on purpose.
 */
function nothingPaired(repo: RepoCoChange): string {
  return (
    `no two files moved together in ${MIN_TOGETHER} or more sessions at ` +
    `${percent(MIN_RATE)} or more · ` +
    `${plural(repo.history, "session", "sessions")} of history`
  );
}

/** The table: paths left, figures right, so the columns can be scanned. */
function table(pairs: readonly CoChangePair[], palette: Palette): string[] {
  const rows = pairs.map((pair) => [
    cell(pair, 0),
    cell(pair, 1),
    figure(pair.sessions),
    percent(pair.rate),
  ]);
  const widths = columnWidths([[...HEADINGS], ...rows]);

  return [
    palette.meta(`${INDENT}${row([...HEADINGS], widths)}`),
    ...rows.map((cells) => `${INDENT}${row(cells, widths, palette.path)}`),
  ];
}

/**
 * One path of a pair, marked where the file is not at the branch tip now.
 *
 * The mark is a word rather than a colour or a symbol: this is the one thing
 * in the row that changes what the row means, and it has to survive a pipe,
 * a CI log and a paste into a bug report. Read the whole line and it says what
 * it is — `src/old/parser.ts (gone)  src/old/lexer.ts (gone)  4  100%` is a
 * pair that was real and is now history.
 */
function cell(pair: CoChangePair, index: 0 | 1): string {
  const path = pair.paths[index];
  return pair.gone.includes(path) ? `${path} ${GONE}` : path;
}

/** How a file that is no longer at the branch tip is marked. */
export const GONE = "(gone)";

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
  const [file = "", partner = "", sessions = "", strength = ""] = cells;
  return [
    ink(padRight(file, widths[0] ?? 0)),
    ink(padRight(partner, widths[1] ?? 0)),
    padLeft(sessions, widths[2] ?? 0),
    padLeft(strength, widths[3] ?? 0),
  ]
    .join("  ")
    .trimEnd();
}

/**
 * The two things the tables cannot say for themselves: what the strength
 * column is a share of, and which files were never eligible.
 *
 * Printed once, under everything, and only when something was listed. A legend
 * over an empty report is a line the reader has to check the report against to
 * find out it says nothing.
 *
 * The denominator is worth spelling out. Without it, `86%` reads as either
 * file's own rate, and the number is deliberately the weaker of the two — the
 * commoner file's — so a reader who assumed the other one would be reading the
 * pair as a stronger claim than it is.
 */
function footnotes(report: CoChangeReport, palette: Palette): string[] {
  if (report.repos.every((repo) => (repo.pairs ?? []).length === 0)) {
    return [];
  }

  return [
    "",
    palette.meta(
      `${INDENT}strength is the sessions a pair moved together in, over every ` +
        "session the commoner of the two appeared in",
    ),
    ...goneLines(report, palette),
    palette.meta(`${INDENT}${IGNORED_CLASSES.join(", ")} files are never listed`),
  ];
}

/**
 * What the mark means, and how to be rid of it.
 *
 * Only where something is actually marked. The pair was real — the sessions
 * that moved those files together happened — and what has changed is that one
 * of them is not there to move any more, which makes the row history rather
 * than a fact about the repository in front of the reader. Both readings are
 * worth having, so the row stays and the note names the flag that drops it.
 */
function goneLines(report: CoChangeReport, palette: Palette): string[] {
  const marked = report.repos
    .flatMap((repo) => repo.pairs ?? [])
    .some((pair) => pair.gone.length > 0);
  if (!marked) {
    return [];
  }

  return [
    palette.meta(
      `${INDENT}${GONE} is a file that is not at the branch tip now — the pair moved ` +
        "together, and one half of it has since been split up, renamed or deleted",
    ),
    palette.meta(`${INDENT}session cochange --current lists only the pairs still there`),
  ];
}
