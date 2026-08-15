import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SessionCost } from "../../store.js";
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
  tokens: number;
  model: string;
  edited: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Every token the call moved: fresh input, both cache tiers, and output.
 * Cached input is most of the traffic in a long session, so leaving it out
 * would report a fraction of what was actually spent.
 */
function totalTokens(usage: Record<string, unknown>): number {
  return (
    num(usage["input_tokens"]) +
    num(usage["cache_creation_input_tokens"]) +
    num(usage["cache_read_input_tokens"]) +
    num(usage["output_tokens"])
  );
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

/**
 * Folds one transcript's assistant entries into `calls`, keyed by requestId
 * so repeated streaming fragments collapse into a single API call.
 */
function foldTranscript(text: string, window: CaptureWindow, calls: Map<string, Call>): void {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a partial trailing line, or a format we do not know
    }
    if (!isObject(entry) || entry["type"] !== "assistant") {
      continue;
    }

    const requestId = entry["requestId"];
    const timestamp = entry["timestamp"];
    if (typeof requestId !== "string" || typeof timestamp !== "string") {
      continue;
    }
    const at = Date.parse(timestamp);
    if (Number.isNaN(at) || at < from || at > to) {
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

    const existing = calls.get(requestId);
    if (existing) {
      // Same call, another fragment: usage is already counted, but a later
      // fragment may be the one carrying the tool call.
      existing.edited ||= edited;
      continue;
    }

    const usage = message["usage"];
    calls.set(requestId, {
      tokens: isObject(usage) ? totalTokens(usage) : 0,
      model: typeof message["model"] === "string" ? message["model"] : "",
      edited,
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
 * A `run` here is one API call, not one prompt: assistant entries carry no
 * prompt identifier, so the request is the only unit the transcript makes
 * available without walking parent links. An `emptyRun` is a call that
 * produced no file-writing tool use — it cost tokens and changed nothing.
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
      const calls = new Map<string, Call>();

      for (const file of files) {
        let text: string;
        try {
          text = await readFile(file, "utf8");
        } catch {
          continue;
        }
        foldTranscript(text, window, calls);
      }

      const callsByModel = new Map<string, number>();
      let tokens = 0;
      let emptyRuns = 0;
      for (const call of calls.values()) {
        tokens += call.tokens;
        if (!call.edited) {
          emptyRuns += 1;
        }
        if (call.model !== "") {
          callsByModel.set(call.model, (callsByModel.get(call.model) ?? 0) + 1);
        }
      }

      return { tokens, runs: calls.size, emptyRuns, model: dominant(callsByModel) };
    },
  };
}
