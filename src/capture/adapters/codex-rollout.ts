// What a Codex rollout says about turns: one per `task_started` turn_id, modelled by its `turn_context`.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** One turn as the rollout started it. */
export interface RolloutTurn {
  at: number;
  id: string;
  /** `turn_context.model`; null where the turn has no context or the context names none. */
  model: string | null;
  cwd?: string;
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
}

export function emptyRollout(): Rollout {
  return { started: new Map(), contexts: new Map() };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

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

/** Notes a turn's start; a turn started twice keeps its first instant. */
function foldStart(rollout: Rollout, record: Line): void {
  const id = str(record.payload["turn_id"]);
  if (record.type !== "event_msg" || record.payload["type"] !== "task_started") return;
  if (id !== undefined && !Number.isNaN(record.at) && !rollout.started.has(id)) rollout.started.set(id, record.at);
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
}

/** Every started turn, with its context's model and cwd where it has one; a context alone is no turn. */
export function turnsOf(rollout: Rollout): RolloutTurn[] {
  return [...rollout.started].map(([id, at]) => {
    const context = rollout.contexts.get(id);
    return { id, at, model: context?.model ?? null, ...(context?.cwd === undefined ? {} : { cwd: context.cwd }) };
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
