// Which end states were on the default branch before their session began (SES-9).
//
// Landed is decided on content: the blob a session left is somewhere in the
// default branch's history at that path. That is the right test for a squash
// or a rebase, and the wrong one for a revert. A session that puts a file back
// to what it held last month leaves a blob the branch already has, and would
// read as merged the moment it stopped, with nothing merged at all.
//
// So a blob counts as landed only where some default-branch commit holding it
// at that path is not an ancestor of the commit the session started from: it
// arrived after the session began, which is what landing means. A revert that
// is later merged arrives again in a new commit, and lands then. Where git
// cannot say — the start commit is gone, or not a commit — nothing is marked,
// and the content test stands as it always has.
import { execFileAsync, repoRoot, tryGit } from "./run.js";
import { blobIds } from "./blobs.js";
import type { Session } from "../store.js";
import { preexistingKey } from "../outcome.js";

const SHA = /^[0-9a-f]{7,64}$/;

/** True or false where git answers; undefined where it cannot (exit status other than 0 or 1). */
async function isAncestor(root: string, commit: string, of: string): Promise<boolean | undefined> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", commit, of], { cwd: root });
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 1 ? false : undefined;
  }
}

/** Each default-branch commit that touched `path`, with the blob it left there; read once per path per call. */
type PathLog = Map<string, Promise<{ commit: string; blob: string | undefined }[]>>;

function pathLog(root: string, branch: string, path: string, cache: PathLog) {
  let log = cache.get(path);
  if (log === undefined) {
    log = (async () => {
      const out = await tryGit(root, ["log", "--format=%H", branch, "--", path]);
      const commits = (out ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
      const ids = await blobIds(root, commits.map((commit) => `${commit}:${path}`));
      return commits.map((commit, index) => ({ commit, blob: ids[index] }));
    })();
    cache.set(path, log);
  }
  return log;
}

/**
 * Every session and path whose end state the branch held only before the
 * session started. Asked only of paths whose blob is in the branch's history
 * at all (`history`), since the rest cannot have landed either way.
 */
export async function preexistingEndStates(
  sessions: readonly Session[],
  branch: string,
  history: ReadonlyMap<string, ReadonlySet<string>>,
  cwd: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  const root = await repoRoot(cwd);
  const cache: PathLog = new Map();
  for (const session of sessions) {
    if (!SHA.test(session.startCommit)) continue;
    for (const [path, ended] of Object.entries(session.endState ?? {})) {
      if (ended === null || !history.get(path)?.has(ended)) continue;
      const holding = (await pathLog(root, branch, path, cache)).filter((entry) => entry.blob === ended);
      const answers = await Promise.all(holding.map((entry) => isAncestor(root, entry.commit, session.startCommit)));
      if (answers.length > 0 && answers.every((answer) => answer === true)) found.add(preexistingKey(session.id, path));
    }
  }
  return found;
}
