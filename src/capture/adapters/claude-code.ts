import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SessionCost } from "../../store.js";
import { NO_COST, type Adapter, type CaptureWindow } from "../adapter.js";
import {
  costOfCalls,
  isUserAuthored,
  parseTranscriptLine,
  recordCall,
  type Call,
  type TranscriptLine,
} from "../transcript.js";

/** Claude Code keeps one JSONL transcript per session, grouped by project. */
export function defaultTranscriptRoot(): string {
  return path.join(homedir(), ".claude", "projects");
}

/** State threaded through every transcript so ids stay unique across files. */
interface Fold {
  calls: Map<string, Call>;
  nextTurn: number;
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
export async function transcriptsTouchedIn(root: string, from: number): Promise<string[]> {
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
function parseEntries(text: string): TranscriptLine[] {
  const entries: TranscriptLine[] = [];
  for (const line of text.split("\n")) {
    const parsed = parseTranscriptLine(line);
    if (parsed !== undefined) {
      entries.push(parsed);
    }
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
    if (at >= from && at <= to && !inAnotherRepo(entry, window)) {
      recordCall(fold.calls, entry, turn);
    }
  }
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
  const root = options.root ?? defaultTranscriptRoot();

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
  return costOfCalls([...fold.calls.values()]);
}

/** A file's contents, or nothing where it could not be read. */
async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
