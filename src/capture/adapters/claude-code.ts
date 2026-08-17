import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { zeroCost, type SessionCost, type TokenCounts } from "../../store.js";
import { dominant, NO_COST, type Adapter, type CaptureWindow } from "../adapter.js";

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
  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return []; // Claude Code has never run here
  }

  const found: string[] = [];
  for (const project of projects) {
    const dir = path.join(root, project);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const file = path.join(dir, name);
      try {
        // A file last written before the window opened cannot contain
        // anything inside it, so this skips most history cheaply.
        const info = await stat(file);
        if (info.mtimeMs >= from) {
          found.push(file);
        }
      } catch {
        continue;
      }
    }
  }
  return found;
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
    if (entry["type"] !== "assistant") {
      continue;
    }

    const requestId = entry["requestId"];
    if (typeof requestId !== "string" || at < from || at > to) {
      continue;
    }
    if (window.cwd !== undefined) {
      const entryCwd = entry["cwd"];
      if (typeof entryCwd === "string" && !relatedPaths(entryCwd, window.cwd)) {
        continue; // another repo's work, running at the same time
      }
    }

    const message = entry["message"];
    if (!isObject(message)) {
      continue;
    }
    const edited = touchesFiles(message);

    const existing = fold.calls.get(requestId);
    if (existing) {
      // Same call, another fragment: usage is already counted, but a later
      // fragment may be the one carrying the tool call.
      existing.edited ||= edited;
      continue;
    }

    fold.calls.set(requestId, {
      ...readUsage(message["usage"]),
      model: typeof message["model"] === "string" ? message["model"] : "",
      edited,
      turn,
    });
  }
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

    async isAvailable(): Promise<boolean> {
      try {
        return (await stat(root)).isDirectory();
      } catch {
        return false;
      }
    },

    async capture(window: CaptureWindow): Promise<SessionCost> {
      const from = Date.parse(window.from);
      if (Number.isNaN(from) || Number.isNaN(Date.parse(window.to))) {
        return NO_COST;
      }

      const files = await transcriptsTouchedIn(root, from);
      const fold: Fold = { calls: new Map(), nextTurn: 0 };

      for (const file of files) {
        let text: string;
        try {
          text = await readFile(file, "utf8");
        } catch {
          continue;
        }
        foldTranscript(text, window, fold);
      }

      const callsByModel = new Map<string, number>();
      // A turn counts once it has a call in the window, and edits anywhere in
      // it make the whole turn productive. Settled before anything is added up,
      // because whether a call belongs to a wasted turn depends on calls that
      // may come after it.
      const turnEdited = new Map<number, boolean>();
      const calls = [...fold.calls.values()];
      for (const call of calls) {
        turnEdited.set(call.turn, (turnEdited.get(call.turn) ?? false) || call.edited);
      }

      const cost = zeroCost();
      const empty = cost.emptyTurnTokens as TokenCounts;

      for (const call of calls) {
        cost.inputTokens += call.inputTokens;
        cost.cacheReadTokens += call.cacheReadTokens;
        cost.cacheCreationTokens += call.cacheCreationTokens;
        cost.outputTokens += call.outputTokens;
        if (turnEdited.get(call.turn) === false) {
          // Every token this call moved was spent inside a turn that ended with
          // nothing written. That is what the waste figure is made of.
          empty.inputTokens += call.inputTokens;
          empty.cacheReadTokens += call.cacheReadTokens;
          empty.cacheCreationTokens += call.cacheCreationTokens;
          empty.outputTokens += call.outputTokens;
        }
        if (!call.edited) {
          cost.callsWithoutEdits += 1;
        }
        if (call.model !== "") {
          callsByModel.set(call.model, (callsByModel.get(call.model) ?? 0) + 1);
        }
      }

      cost.apiCalls = fold.calls.size;
      cost.turns = turnEdited.size;
      cost.emptyTurns = [...turnEdited.values()].filter((edited) => !edited).length;
      cost.model = dominant(callsByModel);
      return cost;
    },
  };
}
