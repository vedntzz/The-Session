// Scope suggestions from past planning misses. No coupling or directory roll-up.
import { inScope, normalizeEntry } from "./scope.js";
import type { ProposalProposer } from "./agreement.js";
import { intentSourceOf, type Session } from "./store.js";

export const PRIME_LIMIT = 5;
export const PRIME_SUPPORT = 3;
export const PRIME_RATE = 0.6;
export const PRIME_RULE = "declared-drift-v1";

export interface PrimeRequest {
  intent: string;
  seeds?: readonly string[];
}

export interface PrimeCandidate {
  path: string;
  reason: "named" | "drift";
  sessions: string[];
}

/** Kept whole at start, alongside the scope the person actually accepted. */
export interface PrimeProposal {
  /** Absent on older records, which read as prime through proposerOf. */
  proposer?: ProposalProposer;
  rule: typeof PRIME_RULE;
  intent: string;
  scope: string[];
  candidates: PrimeCandidate[];
  history: number;
  comparable: number;
  tracked: number;
  omitted: number;
  reason?: string;
}

const STOP_WORDS = new Set(
  "a an the to for of in on and or with from this that it is be add fix update change implement refactor support session src test tests".split(" "),
);

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

/** Two shared content words are evidence of wording, never semantic equivalence. */
function similarIntent(first: string, second: string): boolean {
  const a = words(first);
  const b = words(second);
  return [...a].filter((word) => b.has(word)).length >= 2;
}

/**
 * Only closed, unaided declarations from before the question can train Prime.
 * Accepted Prime scopes cannot become evidence for their own next suggestion.
 * Paths are exact tracked files; no proposal grows a parent directory.
 */
export function proposeScope(
  request: PrimeRequest,
  sessions: readonly Session[],
  trackedPaths: readonly string[],
  repo: string,
  before: string,
): PrimeProposal {
  const intent = request.intent.trim();
  if (!intent) throw new Error('No intent given. Run: session prime "what you are about to do"');
  const seeds = [...new Set((request.seeds ?? []).map(normalizeEntry))];
  if (seeds.some((seed) => !seed || seed === "." || seed.startsWith("/") || seed.split("/").includes(".."))) {
    throw new Error("Prime seeds must name paths inside the repo, not the whole repository.");
  }
  const tracked = [...new Set(trackedPaths)].sort();
  const present = new Set(tracked);
  const history = sessions.filter((s) => s.repo === repo && s.endedAt !== null &&
    Date.parse(s.endedAt) < Date.parse(before) && intentSourceOf(s) === "declared" && s.scope.length > 0);
  const comparable = history.filter((s) => similarIntent(intent, s.intent ?? "") ||
    seeds.some((seed) => s.scope.some((scope) => normalizeEntry(scope) === seed)));
  const base: PrimeProposal = {
    proposer: "prime",
    rule: PRIME_RULE, intent, scope: [], candidates: [], history: history.length,
    comparable: comparable.length, tracked: tracked.length, omitted: 0,
  };
  const missing = seeds.filter((seed) => !tracked.some((file) => inScope([seed], file)));
  if (missing.length) {
    return { ...base, reason: `No tracked files match: ${missing.map((s) => JSON.stringify(s)).join(", ")}. Use --scope with --start for new files.` };
  }
  const named = tracked.filter((file) => inScope(seeds, file));
  if (named.length > PRIME_LIMIT) {
    return { ...base, reason: `The named paths cover ${named.length} files. Name at most ${PRIME_LIMIT} specific files with --seed.` };
  }
  const candidates: PrimeCandidate[] = named.map((path) => ({ path, reason: "named", sessions: [] }));
  if (comparable.length >= PRIME_SUPPORT) {
    const counts = new Map<string, string[]>();
    for (const session of comparable) {
      for (const path of new Set(session.drift)) {
        if (!present.has(path) || named.includes(path)) continue;
        // A subsequent unaided declaration cleared this planning miss.
        if (history.some((later) => Date.parse(later.startedAt) > Date.parse(session.endedAt!) && inScope(later.scope, path))) continue;
        counts.set(path, [...(counts.get(path) ?? []), session.id]);
      }
    }
    candidates.push(...[...counts].filter(([, ids]) => ids.length >= PRIME_SUPPORT && ids.length / comparable.length >= PRIME_RATE)
      .map(([path, ids]): PrimeCandidate => ({ path, reason: "drift", sessions: ids }))
      .sort((a, b) => b.sessions.length - a.sessions.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
  }
  const selected = candidates.slice(0, PRIME_LIMIT);
  return {
    ...base, scope: selected.map((c) => c.path), candidates: selected,
    omitted: Math.max(0, candidates.length - PRIME_LIMIT),
    ...(selected.length ? {} : { reason: `No supported suggestion. Name files with --seed, or declare your own scope with session start --scope.` }),
  };
}
