import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { zeroCost, type SessionCost, type TokenCounts } from "../../store.js";
import { addTokens, dominant, NO_COST, type Adapter, type CaptureWindow } from "../adapter.js";

/** Claude Code keeps one JSONL transcript per session, grouped by project. */
function defaultRoot(): string {
  return path.join(homedir(), ".claude", "projects");
}

/** Tool calls that write to the working tree. */
const EDITING_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * One API call, folded across however many transcript lines reported it.
 * Streaming writes the same `requestId` several times with an identical usage
 * block, so usage is taken once while tool use is OR-ed across fragments.
 */
interface Call {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  model: string;
  edited: boolean;
  /** Which developer turn this call belongs to; unique across transcripts. */
  turn: number;
}

/** State threaded through every transcript so ids stay unique across files. */
interface Fold {
  calls: Map<string, Call>;
  nextTurn: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The four token counters a call reports, kept apart because they bill at
 * different rates. Cached input is most of the traffic in a long session, so
 * none of these may be dropped.
 */
function readUsage(usage: unknown): Pick<
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
 */
function isUserAuthored(entry: Record<string, unknown>): boolean {
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
function touchesFiles(message: Record<string, unknown>): boolean {
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
 * True when two working directories belong to the same checkout. Compared
 * both ways because `session stop` may run from a subdirectory of the repo
 * the agent was started in, or the other way round.
 */
function relatedPaths(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep);
}

/** Transcript files that could hold activity in the window, newest first. */
async function transcriptsTouchedIn(root: string, from: number): Promise<string[]> {
  const found: string[] = [];
  for (const project of await listDir(root)) {
    found.push(...(await transcriptsIn(path.join(root, project), from)));
  }
  return found;
}

/** What a directory holds, or nothing where there is no directory to read. */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return []; // Claude Code has never run here
  }
}

/** One project's transcripts, less the ones written before the window opened. */
async function transcriptsIn(dir: string, from: number): Promise<string[]> {
  const found: string[] = [];
  for (const name of await listDir(dir)) {
    const file = path.join(dir, name);
    if (name.endsWith(".jsonl") && (await touchedSince(file, from))) {
      found.push(file);
    }
  }
  return found;
}

/**
 * True when the file was last written inside the window. A file older than
 * that cannot contain anything inside it, so this skips most history cheaply.
 */
async function touchedSince(file: string, from: number): Promise<boolean> {
  try {
    return (await stat(file)).mtimeMs >= from;
  } catch {
    return false;
  }
}

/** Parses a transcript into timestamped entries, dropping what we cannot read. */
function parseEntries(text: string): { at: number; entry: Record<string, unknown> }[] {
  const entries: { at: number; entry: Record<string, unknown> }[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a partial trailing line, or a format we do not know
    }
    if (!isObject(parsed)) {
      continue;
    }
    const timestamp = parsed["timestamp"];
    const at = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    if (Number.isNaN(at)) {
      continue;
    }
    entries.push({ at, entry: parsed });
  }
  return entries;
}

/**
 * Folds one transcript into `fold`, splitting it into turns at every
 * developer-authored entry and keying calls by requestId so repeated
 * streaming fragments collapse into a single API call.
 *
 * Segmentation looks at the whole transcript, but only calls inside the
 * window are recorded — so a turn that began before the session started
 * still counts, on the strength of the calls it made once it had.
 */
function foldTranscript(text: string, window: CaptureWindow, fold: Fold): void {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);

  // Sort is stable, so entries sharing a timestamp keep their file order and
  // an assistant reply can never sort ahead of the prompt that caused it.
  const entries = parseEntries(text).sort((a, b) => a.at - b.at);

  // Calls before the first prompt (a resumed transcript) form their own turn.
  let turn = fold.nextTurn++;

  for (const { at, entry } of entries) {
    if (isUserAuthored(entry)) {
      turn = fold.nextTurn++;
      continue;
    }
    if (at >= from && at <= to) {
      recordCall(entry, turn, window, fold);
    }
  }
}

/**
 * Records one entry as a call, or merges it into the call it is another
 * fragment of. Anything that is not an assistant reply this repo made is
 * dropped.
 */
function recordCall(
  entry: Record<string, unknown>,
  turn: number,
  window: CaptureWindow,
  fold: Fold,
): void {
  if (entry["type"] !== "assistant") {
    return;
  }
  const requestId = entry["requestId"];
  if (typeof requestId !== "string" || inAnotherRepo(entry, window)) {
    return;
  }
  const message = entry["message"];
  if (!isObject(message)) {
    return;
  }
  const edited = touchesFiles(message);

  const existing = fold.calls.get(requestId);
  if (existing) {
    // Same call, another fragment: usage is already counted, but a later
    // fragment may be the one carrying the tool call.
    existing.edited ||= edited;
    return;
  }
  fold.calls.set(requestId, {
    ...readUsage(message["usage"]),
    model: typeof message["model"] === "string" ? message["model"] : "",
    edited,
    turn,
  });
}

/** True when the entry is another repo's work, running at the same time. */
function inAnotherRepo(entry: Record<string, unknown>, window: CaptureWindow): boolean {
  if (window.cwd === undefined) {
    return false;
  }
  const entryCwd = entry["cwd"];
  return typeof entryCwd === "string" && !relatedPaths(entryCwd, window.cwd);
}

export interface ClaudeCodeOptions {
  /** Transcript root. Defaults to `~/.claude/projects`. */
  root?: string;
}

/**
 * Reads Claude Code's JSONL transcripts and reports what a session spent.
 *
 * The unit is one API call, not one prompt: assistant entries carry no prompt
 * identifier, so the request is the only unit the transcript makes available
 * without walking parent links. A call without edits produced no file-writing
 * tool use — it cost tokens and changed nothing.
 */
export function createClaudeCodeAdapter(options: ClaudeCodeOptions = {}): Adapter {
  const root = options.root ?? defaultRoot();

  return {
    name: "claude-code",
    isAvailable: () => isDirectory(root),
    capture: (window) => captureWindow(root, window),
  };
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Every call any transcript reports inside the window, added up. */
async function captureWindow(root: string, window: CaptureWindow): Promise<SessionCost> {
  const from = Date.parse(window.from);
  if (Number.isNaN(from) || Number.isNaN(Date.parse(window.to))) {
    return NO_COST;
  }

  const fold: Fold = { calls: new Map(), nextTurn: 0 };
  for (const file of await transcriptsTouchedIn(root, from)) {
    const text = await readText(file);
    if (text !== undefined) {
      foldTranscript(text, window, fold);
    }
  }
  return costOf([...fold.calls.values()]);
}

/** A file's contents, or nothing where it could not be read. */
async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Adds the calls up into one session's cost.
 *
 * Which turns produced nothing is settled first, before anything is counted: a
 * turn counts once it has a call in the window, edits anywhere in it make the
 * whole turn productive, and whether a call belongs to a wasted turn therefore
 * depends on calls that may come after it.
 */
function costOf(calls: readonly Call[]): SessionCost {
  const turnEdited = new Map<number, boolean>();
  for (const call of calls) {
    turnEdited.set(call.turn, (turnEdited.get(call.turn) ?? false) || call.edited);
  }

  const cost = zeroCost();
  const callsByModel = new Map<string, number>();
  for (const call of calls) {
    addTokens(cost, call);
    if (turnEdited.get(call.turn) === false) {
      // Every token this call moved was spent inside a turn that ended with
      // nothing written. That is what the waste figure is made of.
      addTokens(cost.emptyTurnTokens as TokenCounts, call);
    }
    if (!call.edited) {
      cost.callsWithoutEdits += 1;
    }
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
