// What a Codex rollout says about turns: one per `task_started` turn_id, modelled by its `turn_context`.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { TokenCounts } from "../../store.js";
import { addTokens } from "../adapter.js";

/** One turn as the rollout started it. */
export interface RolloutTurn {
  at: number;
  id: string;
  /** `turn_context.model`; null where the turn has no context or the context names none. */
  model: string | null;
  cwd?: string;
  /** Summed `last_token_usage`; null where no usage was recorded for the turn. */
  tokens: TokenCounts | null;
}

/** What a turn's `turn_context` adds; the first one written for a turn wins. */
interface TurnContext {
  model: string | null;
  cwd?: string;
}

/** A rollout reduced to where it ran, when each turn started, and each turn's context. */
export interface Rollout {
  cwd?: string;
  started: Map<string, number>;
  contexts: Map<string, TurnContext>;
  usage: Map<string, TokenCounts>;
  /** The turn a `token_count` belongs to: the last one started and not yet complete. */
  current?: string;
  /** The previous cumulative total, so a total emitted twice in a row is counted once. */
  lastTotal?: string;
}

export function emptyRollout(): Rollout {
  return { started: new Map(), contexts: new Map(), usage: new Map() };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

interface Line {
  type: unknown;
  at: number;
  payload: Record<string, unknown>;
}

/** One line as a record with a payload, or nothing where it cannot be read. */
function parseLine(line: string): Line | undefined {
  try {
    const record: unknown = JSON.parse(line);
    if (!isObject(record) || !isObject(record["payload"])) return undefined;
    return { type: record["type"], at: Date.parse(str(record["timestamp"]) ?? ""), payload: record["payload"] };
  } catch {
    return undefined; // a partial trailing write, or not JSON
  }
}

/** Notes a turn's start, or its end; a turn started twice keeps its first instant. */
function foldStart(rollout: Rollout, record: Line): void {
  if (record.type !== "event_msg") return;
  if (record.payload["type"] === "task_complete") rollout.current = undefined;
  const id = str(record.payload["turn_id"]);
  if (record.payload["type"] !== "task_started" || id === undefined || Number.isNaN(record.at)) return;
  rollout.current = id;
  if (!rollout.started.has(id)) rollout.started.set(id, record.at);
}

/** One request's usage, cached reads taken out of `input_tokens`; cache writes recorded as reported, never subtracted. */
export function splitUsage(usage: unknown): TokenCounts {
  const fields = isObject(usage) ? usage : {};
  const cacheRead = num(fields["cached_input_tokens"]);
  const cacheWrite = num(fields["cache_write_input_tokens"]);
  const input = Math.max(0, num(fields["input_tokens"]) - cacheRead);
  return { inputTokens: input, cacheReadTokens: cacheRead, cacheCreationTokens: cacheWrite, outputTokens: num(fields["output_tokens"]) };
}

/** Adds a `token_count`'s `last_token_usage` to the running turn, unless its total repeats the one before. */
function foldUsage(rollout: Rollout, record: Line): void {
  const info = record.payload["info"];
  if (record.type !== "event_msg" || record.payload["type"] !== "token_count" || !isObject(info)) return;
  const total = JSON.stringify(info["total_token_usage"] ?? null);
  if (total === rollout.lastTotal) return; // the same total emitted twice in a row
  rollout.lastTotal = total;
  if (rollout.current === undefined) return;
  const add = splitUsage(info["last_token_usage"]);
  const sum = rollout.usage.get(rollout.current);
  if (sum === undefined) rollout.usage.set(rollout.current, add);
  else addTokens(sum, add);
}

/** Notes a turn's context; a context written again (at compaction) is ignored. */
function foldContext(rollout: Rollout, record: Line): void {
  const id = str(record.payload["turn_id"]);
  if (record.type !== "turn_context" || id === undefined || rollout.contexts.has(id)) return;
  const cwd = str(record.payload["cwd"]);
  rollout.contexts.set(id, { model: str(record.payload["model"]) ?? null, ...(cwd === undefined ? {} : { cwd }) });
}

/** Folds one line in. */
export function foldRolloutLine(rollout: Rollout, line: string): void {
  const record = line.trim() === "" ? undefined : parseLine(line);
  if (record === undefined) return;
  if (record.type === "session_meta" && rollout.cwd === undefined) {
    rollout.cwd = str(record.payload["cwd"]);
  }
  foldStart(rollout, record);
  foldContext(rollout, record);
  foldUsage(rollout, record);
}

/** Every started turn, with its context's model and cwd where it has one; a context alone is no turn. */
export function turnsOf(rollout: Rollout): RolloutTurn[] {
  return [...rollout.started].map(([id, at]) => {
    const context = rollout.contexts.get(id);
    const tokens = rollout.usage.get(id) ?? null;
    return { id, at, model: context?.model ?? null, tokens, ...(context?.cwd === undefined ? {} : { cwd: context.cwd }) };
  });
}

/** A rollout read a line at a time; what was read before an error is kept. */
export async function readRollout(file: string): Promise<Rollout> {
  const rollout = emptyRollout();
  try {
    const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of lines) foldRolloutLine(rollout, line);
  } catch {
    // unreadable or vanished mid-read: the turns already folded stand
  }
  return rollout;
}
