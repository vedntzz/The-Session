// Codex rollouts: turns and the model each ran on. No tokens yet, so every turn is untokened.
import { homedir } from "node:os";
import path from "node:path";
import { zeroCost, type SessionCost } from "../../store.js";
import { dominant, NO_COST, type Adapter, type CaptureWindow } from "../adapter.js";
import { readRollout, turnsOf, type Rollout, type RolloutTurn } from "./codex-rollout.js";
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

/** The turns a rollout opened inside the window, in this repo. */
export function turnsInWindow(rollout: Rollout, window: CaptureWindow): RolloutTurn[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return turnsOf(rollout).filter((turn) => turn.at >= from && turn.at <= to && inRepo(turn, rollout, window.cwd));
}

/** Codex's id for history imported into a thread; `test/codex.test.ts` trips if it is renamed. */
const IMPORTED = "external-import-";

/** Turns as a cost: counted and modelled, with no tokens claimed; imported history counted apart. */
export function costOfTurns(all: readonly RolloutTurn[]): SessionCost {
  const turns = all.filter((turn) => !turn.id.startsWith(IMPORTED));
  const skipped = all.length - turns.length;
  if (all.length === 0) return NO_COST;
  const cost = { ...zeroCost(), ...(skipped > 0 ? { importedTurnsSkipped: skipped } : {}) };
  if (turns.length === 0) return cost;
  const turnModels = [...turns].sort((a, b) => a.at - b.at).map((turn) => turn.model);
  const byModel = new Map<string, number>();
  for (const model of turnModels) if (model !== null) byModel.set(model, (byModel.get(model) ?? 0) + 1);
  return { ...cost, turns: turns.length, untokenedTurns: turns.length, turnModels, model: dominant(byModel) };
}

async function captureWindow(root: string, window: CaptureWindow): Promise<SessionCost> {
  const from = Date.parse(window.from);
  if (Number.isNaN(from) || Number.isNaN(Date.parse(window.to))) return NO_COST;
  const turns: RolloutTurn[] = [];
  for (const file of await rolloutsTouchedIn(root, from)) {
    turns.push(...turnsInWindow(await readRollout(file), window));
  }
  return costOfTurns(turns);
}

export interface CodexOptions {
  /** Rollout root. Defaults to `${CODEX_HOME:-~/.codex}/sessions`. */
  root?: string;
}

/** Reads Codex rollouts for turns and per-turn models; reality stays git's, never FileChange's. */
export function createCodexAdapter(options: CodexOptions = {}): Adapter {
  const root = options.root ?? defaultCodexRoot();
  return { name: "codex", isAvailable: () => isDirectory(root), capture: (window) => captureWindow(root, window) };
}
