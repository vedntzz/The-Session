// The I/O half of `cochange.ts`: every log on this machine, read and folded,
// and every checkout it can find, asked what is still there.
import { cochangeOf, onlyCurrent, withTips, type CoChangeReport, type RepoTip } from "../cochange.js";
import { absentAt, defaultBranch, isRepo, repoRoot } from "../git.js";
import { readAllSessions } from "./debt.js";
import { directoryOf, repoIdentity, type StoreOptions } from "../store.js";

/**
 * `session cochange` reads every repository's log, like `session debt`.
 *
 * The same reasons hold. Which files move together is a pattern that takes
 * months of sessions to appear, and "which repo should I ask about" is a
 * question this report answers rather than one it should demand an answer to
 * first.
 *
 * Reading is `readAllSessions`, shared with `debt` rather than copied. It
 * folds the two logs of a repo that changed identity back into one, and a
 * second reader here would give the two commands different histories to work
 * from — which is worst exactly where it matters, since a halved history is
 * what the floor in `repoCoChange` turns into "not enough to judge".
 *
 * Unlike `debt`, this half then goes to the repository — see `tipsFor`. It is
 * still read-only: it asks git what a branch tip holds and writes nothing,
 * anywhere.
 */

/** What `session cochange` found, with each checkout that could be asked asked. */
export async function cochangeReport(
  options: StoreOptions = {},
  currentOnly = false,
): Promise<CoChangeReport> {
  const found = cochangeOf(await readAllSessions(options));
  const report = withTips(found, await tipsFor(found, options));
  return currentOnly ? onlyCurrent(report) : report;
}

/**
 * What each repository's branch tip still holds, for the repos there is a
 * checkout to ask.
 *
 * A log names repositories, not directories, and most of the ones in a store
 * are not the one being stood in — a clone on another machine, a checkout
 * since deleted, a repo whose only trace here is its remote. Those cannot be
 * asked, and the report says so rather than reporting their pairs as current.
 *
 * Two can be found. The checkout this command was run from, matched by
 * identity rather than by path so that a subdirectory finds its own repo; and
 * any log still keyed on a location, which names a directory outright. A
 * directory is used only when it is still the repository that identity belongs
 * to — one that has since gained a different remote, or become a subdirectory
 * of some larger checkout, is a different repository now, and asking it about
 * these paths would answer with somebody else's tree.
 *
 * Only the paths the report actually lists are asked about. Everything else in
 * the log would be a question whose answer is never printed.
 */
async function tipsFor(
  report: CoChangeReport,
  options: StoreOptions,
): Promise<Map<string, RepoTip>> {
  const cwd = options.cwd ?? process.cwd();
  const here = await identityOf(cwd);

  const tips = new Map<string, RepoTip>();
  for (const repo of report.repos) {
    const paths = [...new Set((repo.pairs ?? []).flatMap((pair) => pair.paths))].sort();
    if (paths.length === 0) {
      continue;
    }
    const root = await checkoutOf(repo.repo, here, cwd);
    const branch = root === undefined ? undefined : await defaultBranch(root);
    if (root === undefined || branch === undefined) {
      // No checkout, or no branch to judge against. Nothing is written for
      // this repo, which is what leaves `branch` absent on it.
      continue;
    }
    tips.set(repo.repo, { branch: branch.name, gone: await absentAt(root, branch.tip, paths) });
  }
  return tips;
}

/**
 * The root of a checkout that is still the repository this identity names, or
 * nothing where there is none.
 *
 * The identity is asked for again from the directory rather than assumed from
 * the file it was read out of: what a checkout is called is a fact about the
 * checkout now, and a log keyed on a location whose repo has since been given
 * a remote belongs to that remote, not to the path.
 */
async function checkoutOf(
  repo: string,
  here: string | undefined,
  cwd: string,
): Promise<string | undefined> {
  const dir = repo === here ? cwd : directoryOf(repo);
  if (dir === undefined || !(await isRepo(dir))) {
    return undefined;
  }
  const root = await repoRoot(dir);
  return (await repoIdentity(root)) === repo ? root : undefined;
}

/** What the checkout this was run from is called, or nothing outside a repo. */
async function identityOf(cwd: string): Promise<string | undefined> {
  return (await isRepo(cwd)) ? repoIdentity(cwd) : undefined;
}
