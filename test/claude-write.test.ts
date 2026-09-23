import { describe, expect, it } from "vitest";
import { MAX_WRITE_PAYLOAD_BYTES, parseClaudeWrite } from "../src/capture/adapters/claude-write.js";

const edit = { old_string: "private source", new_string: "private replacement" };
const payload = (tool_name: string, tool_input: unknown) => JSON.stringify({
  hook_event_name: "PreToolUse", cwd: "/repo", tool_name, tool_input,
  transcript_path: "/private/transcript", session_id: "editor-session",
});

describe("Claude file-write adapter", () => {
  it.each([
    { tool: "Write", input: { file_path: "/repo/a.ts", content: "private source" } },
    { tool: "Edit", input: { file_path: "/repo/a.ts", ...edit, replace_all: true } },
    { tool: "MultiEdit", input: { file_path: "/repo/a.ts", edits: [edit, { ...edit, replace_all: false }] } },
  ])("extracts only metadata from $tool", ({ tool, input }) => {
    const result = parseClaudeWrite(payload(tool, input));
    expect(result).toEqual({ kind: "write", request: { cwd: "/repo", filePath: "/repo/a.ts" } });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each(["Bash", "Read", "NotebookEdit", "mcp__other__Write", "write"])("keeps unsupported %s separate from malformed writes", (tool) => {
    expect(parseClaudeWrite(payload(tool, null))).toEqual({ kind: "unsupported" });
  });

  it.each([
    { tool: "Write", input: { file_path: "/repo/a.ts" } },
    { tool: "Write", input: { file_path: "/repo/a.ts", content: null } },
    { tool: "Write", input: { file_path: 42, content: "secret" } },
    { tool: "Write", input: { file_path: "", content: "secret" } },
    { tool: "Edit", input: { file_path: "/repo/a.ts", old_string: "secret" } },
    { tool: "Edit", input: { file_path: "/repo/a.ts", ...edit, replace_all: "yes" } },
    { tool: "MultiEdit", input: { file_path: "/repo/a.ts", edits: [] } },
    { tool: "MultiEdit", input: { file_path: "/repo/a.ts", edits: [edit, null] } },
    { tool: "MultiEdit", input: { file_path: "/repo/a.ts", edits: [edit, { old_string: "secret" }] } },
    { tool: "MultiEdit", input: { file_path: "/repo/a.ts", edits: [{ ...edit, file_path: "/other/file" }] } },
  ])("refuses malformed $tool inputs without echoing source", ({ tool, input }) => {
    expect(parseClaudeWrite(payload(tool, input))).toEqual({ kind: "invalid", reason: "invalid-input" });
  });

  it("allows empty replacement content without interpreting it as file deletion", () => {
    expect(parseClaudeWrite(payload("Write", { file_path: "a.ts", content: "" })).kind).toBe("write");
    expect(parseClaudeWrite(payload("Edit", { file_path: "a.ts", old_string: "all text", new_string: "" })).kind).toBe("write");
  });

  it("refuses malformed JSON, wrong events and missing cwd", () => {
    expect(parseClaudeWrite('{"secret":')).toEqual({ kind: "invalid", reason: "invalid-json" });
    for (const value of [null, [], {}, { hook_event_name: "PostToolUse", tool_name: "Write" }]) {
      expect(parseClaudeWrite(JSON.stringify(value))).toEqual({ kind: "invalid", reason: "invalid-event" });
    }
    const value = JSON.parse(payload("Write", { file_path: "a.ts", content: "" }));
    delete value.cwd;
    expect(parseClaudeWrite(JSON.stringify(value))).toEqual({ kind: "invalid", reason: "invalid-input" });
  });

  it("bounds payload bytes before parsing, including multibyte content", () => {
    expect(parseClaudeWrite(" ".repeat(MAX_WRITE_PAYLOAD_BYTES + 1))).toEqual({ kind: "invalid", reason: "payload-too-large" });
    expect(parseClaudeWrite("é".repeat(MAX_WRITE_PAYLOAD_BYTES / 2 + 1))).toEqual({ kind: "invalid", reason: "payload-too-large" });
  });
});
