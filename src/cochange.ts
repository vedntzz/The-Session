// The files that move together. Pure: sessions in, one report out. Nothing
// here reads a file or runs git — see `commands/cochange.ts` for that half.
import { classOfPath } from "./classify.js";
import { IGNORED_CLASSES, MIN_HISTORY } from "./debt.js";
import type { Session } from "./store.js";

/**
 * Co-change: two files that keep turning up in the same session's `reality`.
 *
 * `debt` asks which files work lands in that nobody planned for. This asks a
 * different question of the same column — which files cannot be changed on
 * their own. A handler and its test, a type and the place that constructs it,
 * a migration and the model it is for: the coupling is real, nobody wrote it
 * down, and the only record of it is that session after session touched both.
 *
 * The claim is deliberately small. It is a count over paths that appeared in
 * the same session, and nothing here reads a line of those files or asks a
 * model whether the coupling is good design. Two files moving together may be
 * one idea correctly split in two, or a seam that should not be there. This
 * report does not know which, and does not say.
 *
 * `reality`, not `drift`, because coupling is a fact about the work rather
 * than about anybody's plan: two files that always change together do so in
 * the sessions that declared them as much as in the ones that did not.
 *
 * Two thresholds carry it, and each is a refusal to say more than the log
 * supports:
 *
 * - **Three sessions together, not one.** One session touching two files is
 *   what a session is. `MIN_TOGETHER`.
 * - **Seven times in ten, against the commoner of the two.** A pair that
 *   co-occurred while one of them was changing in everything else is not a
 *   pair — see `MIN_RATE`.
 */

/** How many sessions have to move a pair together before it is a pair. */
export const MIN_TOGETHER = 3;

/**
 * How much of the commoner file's history a pair has to account for.
 *
 * The denominator is whichever of the two appeared in **more** sessions, which
 * makes this the weaker of the pair's two conditional rates: it clears the bar
 * only when each file predicts the other. Divided by the rarer one instead, a
 * `store.ts` that half the repo's sessions touch would come out as the
 * reliable partner of every file in it, and the report would be a list of
 * whichever file is busiest.
 *
 * Seven in ten rather than nine, because the pair worth printing is the one
 * somebody forgets a third of the time. A bar at 0.9 lists only what nobody
 * was going to forget anyway.
 */
export const MIN_RATE = 0.7;

/**
 * Two files that keep moving together.
 *
 * Unordered, and `paths` is sorted — a pair has one identity however the
 * sessions happened to list it, and two runs produce the same row.
 */
export interface CoChangePair {
  /** The two paths, sorted. */
  paths: [string, string];
  /** Sessions whose `reality` held both. */
  sessions: number;
  /**
   * `sessions` over the sessions the commoner of the two appeared in: how much
   * of that file's history this pair accounts for. Never above 1.
   */
  rate: number;
  /**
   * Which of the two paths are not in the branch's tree now, sorted.
   *
   * Always empty for a repo whose `RepoCoChange.branch` is absent: nothing was
   * asked there, so nothing is claimed. Read the two together — an empty list
   * on its own would say "both still there", which is the answer this tool
   * refuses to give when nobody looked.
   */
  gone: string[];
}

/** One file that moves with the one asked about, and how reliably. */
export interface CoChangePartner {
  path: string;
  /** Sessions that held both this path and the one asked about. */
  sessions: number;
  /** The pair's rate, against whichever of the two appeared more often. */
  rate: number;
  /**
   * Whether the file is missing from the branch tip. **Absent** when no
   * checkout was asked — unknown, which is not the same as still there.
   */
  gone?: boolean;
}

/**
 * What a repository's branch tip holds, for the one question this report asks
 * of it: which of these paths are not there any more.
 *
 * Gathered by the caller, since this module runs git no more than it reads
 * files. `commands/cochange.ts` fills it in for every checkout it can find,
 * and leaves out the repos it cannot ask.
 */
export interface RepoTip {
  /** The branch the paths were checked against, e.g. `origin/main`. */
  branch: string;
  /** Which of them are not in that branch's tree now. */
  gone: ReadonlySet<string>;
}

/** One repository's pairs, and how much history they were read off. */
export interface RepoCoChange {
  repo: string;
  /** Sessions recorded for this repo — the history the answer rests on. */
  history: number;
  /**
   * The branch the paths were checked against, where a checkout could be
   * asked. **Absent** when none could be — the log names repositories that are
   * not on this machine, and a report run from one checkout can ask only the
   * ones it can find.
   *
   * Every `gone` in this repo's pairs is empty while this is absent, and the
   * view says outright that nothing was checked. Not asking and finding
   * nothing missing are different answers, and this is which one it was.
   */
  branch?: string;
  /**
   * The pairs, strongest first. **Absent** — not empty — when `history` is
   * under `MIN_HISTORY`.
   *
   * The same distinction `RepoDebt.files` makes, for the same reason. An empty
   * list says this repo has no file that reliably moves with another, which is
   * a finding; an absent one says the log was too short to look.
   */
  pairs?: CoChangePair[];
}

/** What `session cochange` found: one entry per repository, never a total. */
export interface CoChangeReport {
  repos: RepoCoChange[];
}

/**
 * The pairs in a set of sessions, one repository at a time.
 *
 * **Never aggregated across repos.** `src/store.ts` in two codebases is two
 * files, and a pair seen once in each of three repos is not a pair three
 * sessions moved together. Grouping happens here, in the pure half, so no
 * caller can pool them by accident — the rule `debtOf` follows, for the same
 * reason.
 *
 * Repos sort by name. Ranking them by how coupled they are would be the
 * aggregation this refuses, arriving by way of a sort.
 */
export function cochangeOf(sessions: readonly Session[]): CoChangeReport {
  const repos = [...groupByRepo(sessions)]
    .map(([repo, group]) => repoCoChange(repo, group))
    .sort((a, b) => a.repo.localeCompare(b.repo));

  return { repos };
}

/**
 * The same report with each repo's branch tip taken into account.
 *
 * A pair of files that were since split apart, renamed or deleted is a fact
 * about a repository that no longer exists. The coupling was real and the log
 * is not wrong about it, but a reader looking at today's tree cannot act on
 * it, and an unmarked row claims they can. So the missing paths are marked,
 * and `onlyCurrent` will drop the pairs holding them for a reader who only
 * wants the ones still in front of them.
 *
 * Marked rather than dropped by default, because the two questions are both
 * real: what does this repo couple *now*, and what has it been coupling. The
 * second is the one somebody asks after a refactor that was meant to break a
 * pair up — and a report that silently dropped the answer would look like the
 * refactor worked.
 *
 * A repo with no entry in `tips` is left exactly as it was, `branch` absent
 * and every `gone` empty. That is the honest record of a checkout that could
 * not be asked, and the view prints it as one.
 */
export function withTips(
  report: CoChangeReport,
  tips: ReadonlyMap<string, RepoTip>,
): CoChangeReport {
  return {
    repos: report.repos.map((repo) => {
      const tip = tips.get(repo.repo);
      if (!tip || !repo.pairs) {
        return repo;
      }
      return {
        ...repo,
        branch: tip.branch,
        pairs: repo.pairs.map((pair) => ({
          ...pair,
          gone: pair.paths.filter((path) => tip.gone.has(path)),
        })),
      };
    }),
  };
}

/**
 * The same report with the pairs that are no longer there left out.
 *
 * What `--current` asks for. Only pairs in a repo that was actually checked
 * can be dropped: elsewhere nothing was asked, and dropping a pair on the
 * strength of not having looked would be the report answering a question it
 * declined to put. Those repos keep every pair, and the view says why.
 *
 * `history` is untouched. It is a count of sessions recorded, not of pairs
 * printed, and a repo whose every pair was dropped still has the history it
 * has.
 */
export function onlyCurrent(report: CoChangeReport): CoChangeReport {
  return {
    repos: report.repos.map((repo) =>
      repo.pairs ? { ...repo, pairs: repo.pairs.filter((pair) => pair.gone.length === 0) } : repo,
    ),
  };
}

/**
 * The files a path reliably moves with, strongest first.
 *
 * Here before it has a second caller on purpose: `prime` and scope suggestion
 * will both want to answer "you declared `src/api/orders.ts` — these two come
 * with it", and that answer has to be the one `session cochange` prints, or
 * the tool will quote two different sets of partners for one file.
 *
 * Expects **one repository's** sessions and refuses a mixed list rather than
 * pooling it, since a caller holding the store is holding every repo on the
 * machine. `path` is matched exactly, as `reality` records it.
 *
 * No history floor of its own, and it needs none: a pair takes `MIN_TOGETHER`
 * sessions to exist at all, and that is the floor. A path in one of the
 * classes `IGNORED_CLASSES` names has no partners here however often it moved
 * with something — it is not in the index to be found.
 *
 * `tip` is optional and changes what the answer means. Given one, each partner
 * says whether it is still at the branch tip, which is what a caller
 * suggesting a scope needs — a suggestion to declare a deleted file is worse
 * than no suggestion. Without one, `gone` is absent on every partner: unknown,
 * never "still there". Partners are not dropped here either way, for the
 * reason `withTips` gives — the caller knows which of the two questions it is
 * asking.
 */
export function partnersOf(
  path: string,
  sessions: readonly Session[],
  tip?: RepoTip,
): CoChangePartner[] {
  const repos = new Set(sessions.map((session) => session.repo));
  if (repos.size > 1) {
    throw new Error(
      `partnersOf covers one repository at a time, and was given ${repos.size}: ` +
        `${[...repos].sort().join(", ")}. Filter the sessions by repo first.`,
    );
  }

  return pairsOf(pairIndex(sessions))
    .flatMap((pair) => {
      const [first, second] = pair.paths;
      if (first !== path && second !== path) {
        return [];
      }
      const partner = first === path ? second : first;
      return [
        {
          path: partner,
          sessions: pair.sessions,
          rate: pair.rate,
          ...(tip ? { gone: tip.gone.has(partner) } : {}),
        },
      ];
    })
    .sort(byStrength((partner) => partner.path));
}

/** One repository: its history, and what that history is long enough to say. */
function repoCoChange(repo: string, sessions: readonly Session[]): RepoCoChange {
  if (sessions.length < MIN_HISTORY) {
    return { repo, history: sessions.length };
  }
  return { repo, history: sessions.length, pairs: pairsOf(pairIndex(sessions)) };
}

/** The sessions of each repository, in the order they were given. */
function groupByRepo(sessions: readonly Session[]): Map<string, Session[]> {
  const byRepo = new Map<string, Session[]>();
  for (const session of sessions) {
    const existing = byRepo.get(session.repo);
    if (existing) {
      existing.push(session);
    } else {
      byRepo.set(session.repo, [session]);
    }
  }
  return byRepo;
}

/** How often each path appeared, and how often each unordered pair did. */
interface PairIndex {
  /** Sessions each path appeared in, counted once per session. */
  appearances: Map<string, number>;
  /** Sessions each pair appeared in, keyed by `keyOf`. */
  together: Map<string, number>;
}

/**
 * What separates the two halves of a pair key.
 *
 * A NUL, because it is the one byte a path cannot hold. Every printable
 * separator is a character somebody has named a file after, and a key that can
 * be forged by a filename is two pairs counted as one.
 */
const KEY_SEPARATOR = "\u0000";

/** A pair's key and its identity: sorted, so the order it was seen in is lost. */
function keyOf(first: string, second: string): string {
  const [a, b] = first < second ? [first, second] : [second, first];
  return `${a}${KEY_SEPARATOR}${b}`;
}

/**
 * Every path and every pair, counted once per session.
 *
 * Once per session — a session that touched one file forty times is one
 * session — and the classes nobody owns are dropped before anything counts
 * them. A lockfile changes with everything, so left in it would be the
 * reliable partner of half the repo, which is a fact about lockfiles and not
 * about this codebase. The same list `debt` skips, so a repo whose layout
 * lands the wrong file here is fixed by a line in `classify.ts`.
 *
 * A path that only ever appeared alone still counts as having appeared. That
 * is what keeps the rate honest: it is the denominator that knows a file
 * changes on its own most of the time.
 */
function pairIndex(sessions: readonly Session[]): PairIndex {
  const index: PairIndex = { appearances: new Map(), together: new Map() };

  for (const session of sessions) {
    const paths = [...new Set(session.reality)].filter(
      (path) => !IGNORED_CLASSES.includes(classOfPath(path)),
    );

    for (const path of paths) {
      bump(index.appearances, path);
    }
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        bump(index.together, keyOf(paths[i] as string, paths[j] as string));
      }
    }
  }

  return index;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** The pairs that clear both thresholds, strongest first. */
function pairsOf(index: PairIndex): CoChangePair[] {
  const pairs: CoChangePair[] = [];

  for (const [key, sessions] of index.together) {
    if (sessions < MIN_TOGETHER) {
      continue;
    }
    const [first = "", second = ""] = key.split(KEY_SEPARATOR);
    const commoner = Math.max(
      index.appearances.get(first) ?? 0,
      index.appearances.get(second) ?? 0,
    );
    const rate = sessions / commoner;
    if (rate >= MIN_RATE) {
      // Nothing has been asked of a branch tip here: `withTips` is what fills
      // this in, and an empty list until then means "unasked", never "both
      // still there". See `RepoCoChange.branch`.
      pairs.push({ paths: [first, second], sessions, rate, gone: [] });
    }
  }

  return pairs.sort(byStrength((pair) => pair.paths.join(KEY_SEPARATOR)));
}

/**
 * Strongest first, then commonest, then by name.
 *
 * Strength before count because the question is how reliably two files move
 * together and not how busy they are: a pair at 0.9 over four sessions is the
 * stronger claim over one at 0.72 over nine. The name breaks the remaining
 * ties, so the order is total — a report whose rows swap between runs over one
 * log is one nobody can diff.
 */
function byStrength<T extends { sessions: number; rate: number }>(
  name: (row: T) => string,
): (a: T, b: T) => number {
  return (a, b) => b.rate - a.rate || b.sessions - a.sessions || name(a).localeCompare(name(b));
}
