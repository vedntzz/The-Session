import { currentCommit, repoRoot } from "../git.js";
import { runGit, splitNulList } from "../git/run.js";
import { proposeScope, type PrimeProposal, type PrimeRequest } from "../prime.js";
import { readSessions, repoIdentity, type Session, type StoreOptions } from "../store.js";
import { startSession } from "./start.js";

/** A preview reads only the current checkout and its log. */
export async function primeFor(request: PrimeRequest, options: StoreOptions = {}): Promise<PrimeProposal> {
  const cwd = await repoRoot(options.cwd ?? process.cwd());
  if (!(await currentCommit(cwd))) {
    throw new Error("No commits yet. Make one commit before using session prime.");
  }
  const [sessions, repo, files, deleted] = await Promise.all([
    readSessions({ ...options, cwd }), repoIdentity(cwd),
    runGit(cwd, ["ls-files", "-z", "--cached"]),
    runGit(cwd, ["ls-files", "-z", "--deleted"]),
  ]);
  const missing = new Set(splitNulList(deleted));
  return proposeScope(request, sessions, splitNulList(files).filter((file) => !missing.has(file)), repo, new Date().toISOString());
}

/** The explicit --start action accepts the suggestion, or the supplied edits. */
export async function startPrimed(
  proposal: PrimeProposal,
  scope: string[] | undefined,
  options: StoreOptions = {},
): Promise<Session> {
  if (scope === undefined && proposal.scope.length === 0) {
    throw new Error("Prime suggested no scope. Supply --scope with --start, or use session start.");
  }
  return startSession(proposal.intent, {
    ...options, scope: scope ?? proposal.scope, proposal,
  });
}
