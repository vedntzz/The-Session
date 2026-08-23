// The branch work is expected to land on, and what reached it when.
import { repoRoot, isRepo, tryGit } from "./run.js";

// --- where the work went --------------------------------------------------

/**
 * Where to look for the default branch, after `origin/HEAD` has been asked.
 *
 * The remote's copy of each name comes first: in a clone, `origin/main` is
 * what the team has agreed on, and the local `main` is one person's checkout
 * of it, possibly days behind.
 */
export const DEFAULT_BRANCH_FALLBACKS = ["origin/main", "main", "origin/master", "master"] as const;

export interface DefaultBranch {
  /** What to call it in a report, e.g. `origin/main`. */
  name: string;
  /** Its tip commit. */
  tip: string;
}

/**
 * The branch work is expected to end up on.
 *
 * `origin/HEAD` is the honest answer where it is set, since it is the remote's
 * own statement of its default. It frequently is not set in a fresh clone, so
 * the well-known names are tried after it.
 */
export async function defaultBranch(cwd: string = process.cwd()): Promise<DefaultBranch | undefined> {
  const root = await repoRoot(cwd);
  const declared = await tryGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);

  const candidates = [declared?.trim(), ...DEFAULT_BRANCH_FALLBACKS].filter(
    (name): name is string => name !== undefined && name !== "",
  );

  for (const name of candidates) {
    const tip = await tryGit(root, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
    if (tip !== undefined && tip.trim() !== "") {
      return { name, tip: tip.trim() };
    }
  }
  return undefined;
}

/** A commit that reached the default branch, and when it got there. */
export interface Landing {
  /** Full SHA. */
  commit: string;
  /** Committer time, epoch milliseconds. */
  at: number;
}

/**
 * Commits on the default branch since an instant, newest first.
 *
 * Committer time, not author time: a rebase or a squash keeps the author date
 * of work written weeks earlier, and the question here is when it landed, not
 * when it was typed.
 *
 * `undefined` — not an empty list — where there is no repository or no
 * default branch to ask about. The two are different answers: an empty list
 * says nothing landed in the window, and `undefined` says this checkout could
 * not be asked, which is what stops `scan` reporting a directory of
 * unpushed work as work that never landed.
 */
export async function landingsSince(
  cwd: string,
  since: Date,
): Promise<Landing[] | undefined> {
  if (!(await isRepo(cwd))) {
    return undefined;
  }
  const root = await repoRoot(cwd);
  const branch = await defaultBranch(root);
  if (branch === undefined) {
    return undefined;
  }
  const log = await tryGit(root, [
    "log",
    branch.name,
    `--since=${since.toISOString()}`,
    "--format=%H %ct",
  ]);
  return log === undefined ? undefined : readLandings(log);
}

/** One landing per readable line; a line we cannot read is dropped, not guessed at. */
function readLandings(log: string): Landing[] {
  return log
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(readLanding)
    .filter((landing): landing is Landing => landing !== undefined);
}

/** One `%H %ct` line, or nothing where it is not one. */
export function readLanding(line: string): Landing | undefined {
  const [commit, seconds] = line.split(" ");
  const at = Number(seconds);
  if (commit === undefined || commit === "" || !Number.isFinite(at)) {
    return undefined;
  }
  return { commit, at: at * 1000 };
}
