// What a Claude Code transcript line means, and nothing about where the lines
// came from. Shared by the adapter, which folds a window into one session's
// cost, and by `scan`, which folds each transcript into a session of its own.
//
// One file rather than two readers: both answer "what did this cost", and a
// second parser that segmented turns or deduplicated calls even slightly
// differently would have the tool quoting two figures for the same work with
// nothing to say which was right.
import { zeroCost, type SessionCost, type TokenCounts } from "../store.js";
import { addTokens, dominant } from "./adapter.js";

/** Tool calls that write to the working tree. */
export const EDITING_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * One API call, folded across however many transcript lines reported it.
 * Streaming writes the same `requestId` several times with an identical usage
 * block, so usage is taken once while tool use is OR-ed across fragments.
 */
export interface Call {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  model: string;
  edited: boolean;
  /** Which developer turn this call belongs to. */
  turn: number;
}

/**
 * The four token counters a call reports, kept apart because they bill at
 * different rates. Cached input is most of the traffic in a long session, so
 * none of these may be dropped.
 */
export function readUsage(usage: unknown): Pick<
  Call,
  "inputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "outputTokens"
> {
  const fields = isObject(usage) ? usage : {};
  return {
    inputTokens: num(fields["input_tokens"]),
    cacheReadTokens: num(fields["cache_read_input_tokens"]),
    cacheCreationTokens: num(fields["cache_creation_input_tokens"]),
    outputTokens: num(fields["output_tokens"]),
  };
}

/**
 * True when the developer wrote this entry, as opposed to the harness feeding
 * a tool result back to the agent. Both look like `type: "user"`; only the
 * content tells them apart — a tool result is always a list of `tool_result`
 * blocks, while a prompt is a string or a list of text blocks.
 *
 * Sidechain entries are excluded: a subagent's prompt is part of the turn the
 * developer started, not a turn of its own.
 *
 * This is what a turn is cut at, so it is the same test for every reader. A
 * scan that segmented turns differently from the adapter would report a
 * different number of wasted turns for a session `week` had already counted.
 */
export function isUserAuthored(entry: Record<string, unknown>): boolean {
  if (entry["type"] !== "user" || entry["isSidechain"] === true || entry["isMeta"] === true) {
    return false;
  }
  const message = entry["message"];
  if (!isObject(message)) {
    return false;
  }
  const content = message["content"];
  if (typeof content === "string") {
    return true;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return !content.some((block) => isObject(block) && block["type"] === "tool_result");
}

/** True when the assistant message contains a tool call that writes files. */
export function touchesFiles(message: Record<string, unknown>): boolean {
  const content = message["content"];
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) =>
      isObject(block) &&
      block["type"] === "tool_use" &&
      typeof block["name"] === "string" &&
      EDITING_TOOLS.has(block["name"]),
  );
}

/**
 * Wrappers Claude Code puts round its own bookkeeping, which arrives looking
 * like something the developer typed. `/clear` is a real entry in a real
 * transcript and it is not what the session was about.
 */
const NOT_A_PROMPT = /^<(command-name|command-message|command-args|local-command-)/;

/**
 * The words of a prompt, for use as a label.
 *
 * Deliberately not the test that cuts turns — `isUserAuthored` is. A session
 * whose first entry is `/clear` still starts a turn there and still cost what
 * it cost; all that is in question here is what to write in the row. Keeping
 * the two apart is what stops a nicer label changing a cost figure.
 */
export function promptTextOf(entry: Record<string, unknown>): string | undefined {
  const message = entry["message"];
  if (!isObject(message)) {
    return undefined;
  }
  const text = textOf(message["content"]);
  if (text === undefined || text.trim() === "" || NOT_A_PROMPT.test(text.trim())) {
    return undefined;
  }
  return text.trim();
}

/** A message's text, whether it arrived as a string or as text blocks. */
function textOf(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content
    .filter((block): block is Record<string, unknown> => isObject(block))
    .filter((block) => block["type"] === "text" && typeof block["text"] === "string")
    .map((block) => block["text"] as string);
  return parts.length === 0 ? undefined : parts.join(" ");
}

/** One transcript line, with the instant it carries. */
export interface TranscriptLine {
  at: number;
  entry: Record<string, unknown>;
}

/**
 * One line of a transcript, or nothing where it is not a line we can read —
 * a partial trailing write, a format we do not know, an entry with no usable
 * timestamp. Never throws: a transcript is somebody else's file, and one bad
 * line in fourteen megabytes is not a reason to report nothing.
 */
export function parseTranscriptLine(line: string): TranscriptLine | undefined {
  if (line.trim() === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) {
    return undefined;
  }
  const timestamp = parsed["timestamp"];
  const at = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  return Number.isNaN(at) ? undefined : { at, entry: parsed };
}

/**
 * Reads one assistant entry as a call, or merges it into the call it is
 * another fragment of. Returns false where the entry is not a call at all.
 *
 * Keyed by `requestId`, which is what collapses streaming fragments: the same
 * call arrives several times carrying the same usage block, and adding it up
 * each time would multiply the bill by however many fragments the network
 * happened to split it into.
 */
export function recordCall(
  calls: Map<string, Call>,
  entry: Record<string, unknown>,
  turn: number,
): boolean {
  const call = assistantCall(entry);
  if (call === undefined) {
    return false;
  }
  const { requestId, message } = call;
  const edited = touchesFiles(message);

  const existing = calls.get(requestId);
  if (existing) {
    // Same call, another fragment: usage is already counted, but a later
    // fragment may be the one carrying the tool call.
    existing.edited ||= edited;
    return true;
  }
  calls.set(requestId, {
    ...readUsage(message["usage"]),
    model: typeof message["model"] === "string" ? message["model"] : "",
    edited,
    turn,
  });
  return true;
}

/** The parts of an entry that make it a call, or nothing where it is not one. */
function assistantCall(
  entry: Record<string, unknown>,
): { requestId: string; message: Record<string, unknown> } | undefined {
  const requestId = entry["requestId"];
  const message = entry["message"];
  if (entry["type"] !== "assistant" || typeof requestId !== "string" || !isObject(message)) {
    return undefined;
  }
  return { requestId, message };
}

/**
 * Adds the calls up into one session's cost.
 *
 * Which turns produced nothing is settled first, before anything is counted: a
 * turn counts once it has a call in the window, edits anywhere in it make the
 * whole turn productive, and whether a call belongs to a wasted turn therefore
 * depends on calls that may come after it.
 */

export function costOfCalls(calls: readonly Call[]): SessionCost {
  const turnEdited = new Map<number, boolean>();
  for (const call of calls) {
    turnEdited.set(call.turn, (turnEdited.get(call.turn) ?? false) || call.edited);
  }

  const cost = zeroCost();
  const callsByModel = new Map<string, number>();
  for (const call of calls) {
    addCall(cost, call, turnEdited.get(call.turn) === false);
    if (call.model !== "") {
      callsByModel.set(call.model, (callsByModel.get(call.model) ?? 0) + 1);
    }
  }

  cost.apiCalls = calls.length;
  cost.turns = turnEdited.size;
  cost.emptyTurns = [...turnEdited.values()].filter((edited) => !edited).length;
  cost.model = dominant(callsByModel);
  return cost;
}

/** One call's tokens, and its tokens again where its whole turn wrote nothing. */
function addCall(cost: SessionCost, call: Call, turnWroteNothing: boolean): void {
  addTokens(cost, call);
  if (turnWroteNothing) {
    // Every token this call moved was spent inside a turn that ended with
    // nothing written. That is what the waste figure is made of.
    addTokens(cost.emptyTurnTokens as TokenCounts, call);
  }
  if (!call.edited) {
    cost.callsWithoutEdits += 1;
  }
}
