// The sessions whose work a PR's commits carry. The match is `outcome.ts`'s
// content rule unchanged: only the facts it reads are gathered from the PR's
// commits instead of the default branch, so a squash still matches by its bytes.
import { blobIds } from "../git/blobs.js";
import { preexistingEndStates } from "../git/preexisting.js";
import { ARG_CHUNK, chunk, repoRoot, runGit } from "../git/run.js";
import { evidenceFor, type RepoFacts } from "../outcome.js";
import type { Session } from "../store.js";

const SHA = /^[0-9a-f]{40,64}$/u;

/**
 * The sessions with a file whose end state one of `commits` wrote, oldest
 * start first. `commits` is `listCommitsInRange`'s answer, newest last.
 * A deletion never matches: a commit that removes a path carries no blob to
 * compare, and "the file is gone" cannot say whose deletion it was.
 */
export async function matchSessionsToCommits(
  repoDir: string,
  commits: readonly string[],
  sessions: readonly Session[],
): Promise<Session[]> {
  const head = commits.at(-1);
  if (head === undefined) return [];
  const root = await repoRoot(repoDir);
  const history = await writtenIn(root, commits, endStatePaths(sessions));
  const preexisting = await preexistingEndStates(sessions, head, history, root);
  const facts: RepoFacts = { branch: head, tip: head, history, absentAtTip: new Set(), working: new Map(), preexisting };
  return sessions
    .filter((session) => evidenceFor(session, facts).some((file) => file.landed))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

function endStatePaths(sessions: readonly Session[]): string[] {
  return [...new Set(sessions.flatMap((session) => Object.keys(session.endState ?? {})))].sort();
}

/**
 * Per path, the blobs the commits wrote there: held at the commit and at none
 * of its parents. Held alone would credit the PR with every file it left
 * untouched, and a merge with what it only brought across.
 */
async function writtenIn(
  root: string,
  commits: readonly string[],
  paths: readonly string[],
): Promise<Map<string, ReadonlySet<string>>> {
  const parents = await parentsOf(root, commits);
  const history = new Map<string, Set<string>>(paths.map((path) => [path, new Set()]));
  for (const path of paths) {
    const asked = commits.flatMap((commit) => [commit, ...(parents.get(commit) ?? [])]);
    const ids = await blobIds(root, asked.map((commit) => `${commit}:${path}`));
    const blobAt = new Map(asked.map((commit, index) => [commit, ids[index]]));
    for (const commit of commits) {
      const blob = blobAt.get(commit);
      if (blob !== undefined && (parents.get(commit) ?? []).every((parent) => blobAt.get(parent) !== blob)) {
        history.get(path)?.add(blob);
      }
    }
  }
  return history;
}

/** Each commit's parents; a root commit has none. A non-SHA is refused by name, never read as an option. */
async function parentsOf(root: string, commits: readonly string[]): Promise<Map<string, string[]>> {
  const bad = commits.find((commit) => !SHA.test(commit));
  if (bad !== undefined) throw new Error(`not a full commit SHA: ${bad}. Pass the SHAs listCommitsInRange returns.`);
  const parents = new Map<string, string[]>();
  for (const batch of chunk(commits, ARG_CHUNK)) {
    const stdout = await runGit(root, ["rev-list", "--no-walk", "--parents", ...batch]);
    for (const line of stdout.split("\n").filter((entry) => entry !== "")) {
      const [commit = "", ...rest] = line.split(" ");
      parents.set(commit, rest);
    }
  }
  return parents;
}
