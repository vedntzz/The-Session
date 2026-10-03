// Codex rollouts: turns, the model each ran on, and what each spent from its token_count events.
import { homedir } from "node:os";
import path from "node:path";
import type { AgentInfo } from "../../agents.js";
import { zeroCost, type SessionCost } from "../../store.js";
import { addTokens, dominant, NO_COST, type Adapter, type CaptureWindow, type FirstPrompt } from "../adapter.js";
import { readRollout, sumSpends, turnsOf, type Rollout, type RolloutTurn } from "./codex-rollout.js";
import { isDirectory, listDir, relatedPaths, touchedSince } from "./files.js";

/** `${CODEX_HOME:-~/.codex}/sessions`, laid out as YYYY/MM/DD/rollout-*.jsonl. */
export function defaultCodexRoot(): string {
  return path.join(process.env["CODEX_HOME"] ?? path.join(homedir(), ".codex"), "sessions");
}

/** Every rollout written to since `from`, under the three YYYY/MM/DD levels. */
export async function rolloutsTouchedIn(root: string, from: number): Promise<string[]> {
  let dirs = [root];
  for (let depth = 0; depth < 4; depth++) {
    const next = await Promise.all(dirs.map(async (dir) => (await listDir(dir)).map((name) => path.join(dir, name))));
    dirs = next.flat();
  }
  const rollouts = dirs.filter((file) => /^rollout-.*\.jsonl$/.test(path.basename(file)));
  const touched = await Promise.all(rollouts.map((file) => touchedSince(file, from)));
  return rollouts.filter((_, i) => touched[i]);
}

/** A turn's repo: its own cwd where the context names one, else the thread's. */
function inRepo(turn: RolloutTurn, rollout: Rollout, cwd: string | undefined): boolean {
  if (cwd === undefined) return true;
  const where = turn.cwd ?? rollout.cwd;
  return where !== undefined && relatedPaths(where, cwd); // an unplaced turn is not claimed
}

/**
 * The turns of a rollout that belong to the window, in this repo, each holding
 * only what it spent inside the window (SES-6). A turn belongs when it started
 * inside or spent inside: one that began before `session start` still billed
 * this session for what it did after, and a turn still running at `stop` did
 * not bill it for what came later. A spend whose line had no readable instant
 * cannot be placed, so its turn's tokens are unknown rather than guessed.
 */
export function turnsInWindow(rollout: Rollout, window: CaptureWindow): RolloutTurn[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const inside = (at: number) => at >= from && at <= to;
  return turnsOf(rollout).filter((turn) => inRepo(turn, rollout, window.cwd)).flatMap((turn) => {
    const spends = turn.spends ?? [];
    const spent = spends.filter((spend) => inside(spend.at));
    if (!inside(turn.at) && spent.length === 0) return [];
    const placed = spends.every((spend) => !Number.isNaN(spend.at));
    return [{ ...turn, tokens: spends.length === 0 || !placed ? null : sumSpends(spent) }];
  });
}

/** Codex's id for history imported into a thread; `test/codex.test.ts` trips if it is renamed. */
const IMPORTED = "external-import-";

/** Turns as a cost, each with its model and tokens; imported history counted apart. */
export function costOfTurns(all: readonly RolloutTurn[]): SessionCost {
  const turns = all.filter((turn) => !turn.id.startsWith(IMPORTED)).sort((a, b) => a.at - b.at);
  const skipped = all.length - turns.length;
  if (all.length === 0) return NO_COST;
  const cost = { ...zeroCost(), ...(skipped > 0 ? { importedTurnsSkipped: skipped } : {}) };
  if (turns.length === 0) return cost;
  const turnModels = turns.map((turn) => turn.model);
  const turnTokens = turns.map((turn) => turn.tokens);
  for (const tokens of turnTokens) if (tokens !== null) addTokens(cost, tokens);
  const untokened = turnTokens.filter((tokens) => tokens === null).length;
  return { ...cost, turns: turns.length, ...(untokened > 0 ? { untokenedTurns: untokened } : {}),
    turnModels, turnTokens, model: dominantModel(turnModels) };
}

/** The model most turns ran on; a null model is never named. */
function dominantModel(models: readonly (string | null)[]): string {
  const byModel = new Map<string, number>();
  for (const model of models) if (model !== null) byModel.set(model, (byModel.get(model) ?? 0) + 1);
  return dominant(byModel);
}

/** Every turn inside the window, imports included; nothing for a window that does not parse. */
async function turnsIn(root: string, window: CaptureWindow): Promise<RolloutTurn[] | undefined> {
  const from = Date.parse(window.from);
  if (Number.isNaN(from) || Number.isNaN(Date.parse(window.to))) return undefined;
  const turns: RolloutTurn[] = [];
  for (const file of await rolloutsTouchedIn(root, from)) {
    turns.push(...turnsInWindow(await readRollout(file), window));
  }
  return turns;
}

async function captureWindow(root: string, window: CaptureWindow): Promise<SessionCost> {
  const turns = await turnsIn(root, window);
  return turns === undefined ? NO_COST : costOfTurns(turns);
}

/** The earliest turn in the window that recorded what was typed, and that text; imported history is not this session's. */
async function firstPromptIn(root: string, window: CaptureWindow): Promise<FirstPrompt | undefined> {
  const turns = (await turnsIn(root, window)) ?? [];
  // Typed before the session opened is not what it was asked to do, though the turn's later spend counts.
  const from = Date.parse(window.from);
  const typed = turns.filter((turn) => turn.prompt !== undefined && !turn.id.startsWith(IMPORTED) && turn.at >= from);
  const first = typed.sort((a, b) => a.at - b.at)[0];
  return first === undefined ? undefined : { at: first.at, text: first.prompt! };
}

export interface CodexOptions {
  /** Rollout root. Defaults to `${CODEX_HOME:-~/.codex}/sessions`. */
  root?: string;
}

/** A rollout names no API calls; only this adapter writes a per-turn model, which marks older records. */
export const CODEX_AGENT: AgentInfo = { name: "codex", reportsCalls: false, recognises: (cost) => (cost.turnModels?.length ?? 0) > 0 };

/** Reads Codex rollouts for turns and per-turn models; reality stays git's, never FileChange's. */
export function createCodexAdapter(options: CodexOptions = {}): Adapter {
  const root = options.root ?? defaultCodexRoot();
  return {
    name: CODEX_AGENT.name,
    isAvailable: () => isDirectory(root),
    capture: (window) => captureWindow(root, window),
    firstPrompt: (window) => firstPromptIn(root, window),
  };
}
