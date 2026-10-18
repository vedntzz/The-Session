// `session pr --card` and `--json`: a PR's commits, the sessions they carry, the card's data.
import { knownAgents } from "../capture/index.js";
import { verifyLog } from "../commands/verify.js";
import { defaultBranch } from "../git/branch.js";
import { tryGit } from "../git/run.js";
import { factsFor } from "../observe.js";
import { loadRates } from "../pricing.js";
import { readSessions, storeHome, type Session, type StoreOptions } from "../store.js";
import { buildCardData, type CardInputs } from "./build-card-data.js";
import type { CardData } from "./card-data.js";
import { listCommitsInRange } from "./list-commits-in-range.js";
import { matchSessionsToCommits } from "./match-sessions-to-commits.js";

/** The PR's two ends; either left out takes its default. */
export interface CardRange {
  base?: string;
  head?: string;
}

/** The card's data for base..head; null when no session's work is in it. */
export async function cardDataForRange(range: CardRange, options: StoreOptions = {}): Promise<CardData | null> {
  const cwd = options.cwd ?? process.cwd();
  const head = range.head ?? "HEAD";
  const commits = await listCommitsInRange(cwd, range.base ?? (await defaultBase(cwd, head)), head);
  const sessions = await matchSessionsToCommits(cwd, commits, await readSessions(options));
  return buildCardData(sessions, await cardInputs(sessions, options, cwd));
}

/** Where head left the default branch; no merge base is an error, never a guessed range. */
async function defaultBase(cwd: string, head: string): Promise<string> {
  const branch = await defaultBranch(cwd);
  if (branch === undefined) throw new Error("No default branch found. Pass --base <ref>.");
  const base = (await tryGit(cwd, ["merge-base", "--end-of-options", branch.tip, head]))?.trim();
  if (base) return base;
  // An unknown head also has no merge base; this names it as the unknown ref it is.
  await listCommitsInRange(cwd, branch.tip, head);
  throw new Error(`no common ancestor with ${branch.name}; pass --base <ref>.`);
}

/** Every session lives in this repo's one log, so each is checked by that log's walk. */
async function cardInputs(sessions: readonly Session[], options: StoreOptions, cwd: string): Promise<CardInputs> {
  const { check } = await verifyLog(options);
  const chains = new Map(sessions.map((session) => [session.id, check]));
  const facts = await factsFor(sessions, cwd);
  return { rates: await loadRates(storeHome(options)), agents: knownAgents(), chains, facts, reverted: false };
}
