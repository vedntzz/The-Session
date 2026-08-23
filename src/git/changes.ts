// What changed since a commit.
import { chunk, repoRoot, runGit, splitNulList, tryGit } from "./run.js";

/**
 * Paths that differ from `commit`, relative to the repo root, sorted and
 * deduplicated. Covers tracked edits (staged or not), deletions, and
 * untracked files; files excluded by .gitignore are omitted.
 *
 * Throws if `cwd` is not a repository or `commit` does not resolve.
 */
export async function changedFilesSince(
  commit: string,
  cwd: string = process.cwd(),
): Promise<string[]> {
  const root = await repoRoot(cwd);
  const resolved = await resolveCommit(root, commit);

  // --no-relative defeats a diff.relative config; -z avoids git's quoting of
  // paths containing spaces, newlines or non-ASCII bytes. The revision here is
  // the resolved 40-hex sha, so it can never be mistaken for an option.
  const tracked = await runGit(root, [
    "diff",
    "--name-only",
    "--no-relative",
    "-z",
    resolved,
    "--",
  ]);

  // --full-name is belt-and-braces: output is already root-relative because
  // the command runs from the root.
  const untracked = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--full-name",
    "-z",
  ]);

  const paths = new Set([...splitNulList(tracked), ...splitNulList(untracked)]);
  return [...paths].sort();
}

/** A commit as its 40-hex sha, so nothing downstream can read it as an option. */
export async function resolveCommit(root: string, commit: string): Promise<string> {
  const args = ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`];
  const resolved = await tryGit(root, args);
  if (resolved === undefined) {
    throw new Error(`unknown commit: ${commit}`);
  }
  return resolved.trim();
}
