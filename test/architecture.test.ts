// Where vendor knowledge may live (invariant 5), and what the per-call record
// may depend on. Reads the source as text: these are rules about the code's
// shape, which no behavioural test can see.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { endFor, foldToolCall, startFor } from "../src/tool-calls.js";

const SRC = path.join(import.meta.dirname, "../src");
const ADAPTERS = "capture/adapters/";

function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : entry.name.endsWith(".ts") ? [path.relative(SRC, full)] : [];
  });
}
const text = (file: string) => readFileSync(path.join(SRC, file), "utf8");

/** Claude Code's transcript locations and fields, and its hook wire format. */
const VENDOR = /transcript_path|\.claude\/projects|requestId|tool_use_id|hook_event_name|hookSpecificOutput|permissionDecision|PreToolUse|PostToolUse|SessionEnd|SessionStart|UserPromptSubmit/;

/**
 * Files outside the adapters that know a vendor format today, each for a stated
 * reason. The list is exact: a new file fails, and so does an entry whose file
 * no longer needs it — delete the entry, don't let the list go stale.
 */
const KNOWN_EXCEPTIONS: Record<string, string> = {
  "capture/transcript.ts": "what a transcript line means; the adapter and scan share it (Claude.md layout)",
  "capture/hook.ts": "the Claude Code settings file the installer edits, and its hook event names",
  "commands/check-write.ts": "writes the PreToolUse decision in Claude Code's response format",
  "commands/scan.ts": "scan reads transcripts directly, before any adapter is set up",
  "program/scan.ts": "scan's message naming where it looked",
  "program/hook.ts": "help text naming the PreToolUse event",
  "program/stop.ts": "comment on the SessionEnd hook's budget",
  "program/start.ts": "comment on why the SessionStart handler prints nothing",
  "program/intent.ts": "comment on the UserPromptSubmit hook",
};

describe("vendor formats stay in the adapters", () => {
  it("names every file outside src/capture/adapters/ that knows one, and no other", () => {
    const outside = sources().filter((file) => !file.startsWith(ADAPTERS) && VENDOR.test(text(file))).sort();
    expect(outside).toEqual(Object.keys(KNOWN_EXCEPTIONS).sort());
  });
});

/** Every file a module reaches through relative imports, itself included. */
function importClosure(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, spec] of text(file).matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    importClosure(path.normalize(path.join(path.dirname(file), spec!.replace(/\.js$/, ".ts"))), seen);
  }
  return seen;
}

describe("the per-call record depends on no adapter", () => {
  it.each(["tool-calls.ts", "tree-state.ts"])("%s imports nothing from src/capture/, directly or through another file", (file) => {
    const reached = [...importClosure(file)];
    expect(reached.filter((dep) => dep.startsWith("capture/"))).toEqual([]);
  });

  it("tool-calls.ts reads no transcript, no vendor field and no file", () => {
    const source = text("tool-calls.ts");
    expect(source).not.toMatch(VENDOR);
    expect(source).not.toMatch(/transcript|node:fs|readFile|createReadStream/i);
  });

  it("pairs a start with its end by call id alone: tool name and number play no part", () => {
    let calls = foldToolCall([], 1, { toolCallStart: startFor([], "id-1", "Edit")! });
    calls = foldToolCall(calls, 2, { toolCallStart: startFor(calls, "id-2", "Edit")! });
    // Same tool as both, and a number that is not its own: still matched on id.
    const end = endFor(calls, "id-1", "Bash", {}, {})!;
    expect(end).toMatchObject({ callId: "id-1", n: 1, tool: "Edit" });
    expect(endFor(calls, "no-such-id", "Edit", {}, {})).toMatchObject({ unpaired: true, changed: null });
  });
});
