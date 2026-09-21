import { debtOf, type RepoDebt } from "../debt.js";
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

/**
 * What this checkout owes, by the `debt` rule, for the preview to print beside
 * the suggestion: the files work keeps landing in outside scope that no later
 * declaration has covered.
 *
 * This repo only — the preview is about the work about to start here, and
 * `session prime --debt` is where every repo on the machine is read. Priced
 * against no rates, because the preview prints no money: it is a view before
 * any work, and the cost of past sessions is not what it is for.
 */
export async function debtHere(options: StoreOptions = {}): Promise<RepoDebt> {
  const cwd = await repoRoot(options.cwd ?? process.cwd());
  const [sessions, repo] = await Promise.all([readSessions({ ...options, cwd }), repoIdentity(cwd)]);
  return debtOf(sessions, new Map()).repos.find((entry) => entry.repo === repo) ?? { repo, history: 0 };
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
