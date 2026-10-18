// The commits a PR contains, so its sessions can be matched to them.
import { runGit, tryGit } from "../git/run.js";

/** SHAs reachable from head but not base, oldest first; merges included. */
export async function listCommitsInRange(repoDir: string, base: string, head: string): Promise<string[]> {
  const [from, to] = [await resolveCommit(repoDir, base), await resolveCommit(repoDir, head)];
  const stdout = await runGit(repoDir, ["rev-list", "--reverse", "--topo-order", `${from}..${to}`]);
  return stdout.split("\n").filter((sha) => sha !== "");
}

/** The ref's commit SHA; an unknown ref throws by name, so a typo never reads as an empty PR. */
async function resolveCommit(repoDir: string, ref: string): Promise<string> {
  const sha = await tryGit(repoDir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (sha === undefined || sha.trim() === "") {
    throw new Error(`unknown ref: ${ref}. Fetch it, or pass a branch, tag or SHA this repository has.`);
  }
  return sha.trim();
}
