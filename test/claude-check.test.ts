// The check adapter: one name shared with the transcript adapter, and a parse
// that reads Edit/Write first, then Bash, reporting the tool it saw.
import { describe, expect, it } from "vitest";
import { claudeCheckAdapter } from "../src/capture/adapters/claude-check.js";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";

const payload = (tool: string, input: Record<string, unknown>) =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, cwd: "/repo", tool_input: input });

describe("Claude check adapter", () => {
  it("is named as the transcript adapter is", () => {
    expect(claudeCheckAdapter.name).toBe(createClaudeCodeAdapter().name);
  });

  it("reports the tool for a file write and for a shell command, and nothing else", () => {
    expect(claudeCheckAdapter.parse(payload("Write", { file_path: "a.ts", content: "PRIVATE" })))
      .toEqual({ kind: "write", tool: "Write", request: { cwd: "/repo", filePath: "a.ts" } });
    expect(claudeCheckAdapter.parse(payload("Bash", { command: "ls" })))
      .toEqual({ kind: "shell", tool: "Bash", request: { cwd: "/repo", command: "ls" } });
    expect(claudeCheckAdapter.parse(payload("Read", {}))).toEqual({ kind: "unsupported" });
    expect(claudeCheckAdapter.parse("{")).toEqual({ kind: "invalid", reason: "invalid-json" });
  });
});
