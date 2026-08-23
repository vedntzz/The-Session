// How a line names the files it is about. One rule, because two views print
// this and a reader who learned it in `show` should not meet a different
// answer in `stop`.

/**
 * How many paths a line names before it counts them instead.
 *
 * Three is what fits beside the words around it. Past that the reader is
 * scanning a list rather than reading a line, and the figure they actually
 * wanted — how many — is buried in the middle of it.
 */
export const PATHS_NAMED = 3;

/** How many directories stand in for the paths once there are too many. */
const DIRECTORIES_NAMED = 2;

/** What a path with no directory in it is called. */
const TOP_LEVEL = "the top level";

/** Either the paths themselves, or how many there are and where they are. */
export interface PathSummary {
  /** The paths, when there were few enough to name. Empty when there were not. */
  named: readonly string[];
  /**
   * Where they are instead — `mostly in src/render/ and test/`. Empty while
   * they are named, since the paths have already said it.
   */
  where: string;
  /** How many there are. Exact either way: it is the figure being asked for. */
  count: number;
}

/**
 * The paths, or the count and the two directories most of them are in.
 *
 * The count is never approximate. What is dropped when a list is long is the
 * paths, never the number of them — that number is what tells the reader
 * whether to go and look at the rest.
 */
export function summarizePaths(paths: readonly string[]): PathSummary {
  if (paths.length <= PATHS_NAMED) {
    return { named: paths, where: "", count: paths.length };
  }
  return { named: [], where: whereIn(paths), count: paths.length };
}

/**
 * The fragment a line puts after its label, worded for whichever it is.
 *
 * The separator is the caller's, because a sentence and a column want
 * different ones; the rule that decides between a list and a count is not.
 */
export function describePaths(paths: readonly string[], separator: string): string {
  const summary = summarizePaths(paths);
  // On `where`, not on how many paths came back: no paths at all is a summary
  // that named nothing because there was nothing, and reporting that as
  // "0 files," would be the count standing in for an empty list.
  if (summary.where === "") {
    return summary.named.join(separator);
  }
  return `${summary.count} files, ${summary.where}`;
}

/**
 * Where a set of paths mostly is.
 *
 * `all in` where one directory holds every one of them — "mostly" would
 * understate a fact the paths have already settled, and this line exists
 * because nobody is going to read the paths.
 */
function whereIn(paths: readonly string[]): string {
  const ranked = byFrequency(paths.map(directoryOf));
  const named = ranked.slice(0, DIRECTORIES_NAMED);
  return ranked.length === 1 ? `all in ${named[0]}` : `mostly in ${named.join(" and ")}`;
}

/** Commonest first, ties broken by name so the same paths read the same twice. */
function byFrequency(directories: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const directory of directories) {
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return [...counts]
    .sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName))
    .map(([directory]) => directory);
}

/** The directory a path sits in, trailing slash kept so it reads as one. */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? TOP_LEVEL : path.slice(0, cut + 1);
}
