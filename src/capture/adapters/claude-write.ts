import type { WriteRequestResult } from "../write-request.js";

export const MAX_WRITE_PAYLOAD_BYTES = 2 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function edit(value: unknown): boolean {
  return object(value) && typeof value.old_string === "string" && typeof value.new_string === "string" &&
    (value.replace_all === undefined || typeof value.replace_all === "boolean");
}

/**
 * Current Edit/Write schemas: https://code.claude.com/docs/en/hooks#pretooluse
 * MultiEdit is legacy compatibility for file_path plus a nonempty edits list.
 * Validate text fields, then discard them. Errors never echo payload content.
 */
export function parseClaudeWrite(payload: string): WriteRequestResult {
  if (Buffer.byteLength(payload, "utf8") > MAX_WRITE_PAYLOAD_BYTES) {
    return { kind: "invalid", reason: "payload-too-large" };
  }
  let value: unknown;
  try { value = JSON.parse(payload); }
  catch { return { kind: "invalid", reason: "invalid-json" }; }
  if (!object(value) || value.hook_event_name !== "PreToolUse" || typeof value.tool_name !== "string") {
    return { kind: "invalid", reason: "invalid-event" };
  }
  if (!["Edit", "Write", "MultiEdit"].includes(value.tool_name)) return { kind: "unsupported" };
  const input = value.tool_input;
  if (typeof value.cwd !== "string" || !value.cwd || !object(input) ||
    typeof input.file_path !== "string" || !input.file_path) {
    return { kind: "invalid", reason: "invalid-input" };
  }
  const valid = value.tool_name === "Write" ? typeof input.content === "string" :
    value.tool_name === "Edit" ? edit(input) :
      Array.isArray(input.edits) && input.edits.length > 0 && input.edits.every((item) =>
        edit(item) && Object.keys(item as Record<string, unknown>).every((key) =>
          ["old_string", "new_string", "replace_all"].includes(key)));
  return valid
    ? { kind: "write", tool: value.tool_name, request: { cwd: value.cwd, filePath: input.file_path } }
    : { kind: "invalid", reason: "invalid-input" };
}
