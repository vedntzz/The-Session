// A Claude Code Bash PreToolUse payload, reduced to the command and where it
// runs. The command text is held only long enough to be read by the shell
// recognizers; it is never stored, logged or echoed in a response.
import { MAX_WRITE_PAYLOAD_BYTES } from "./claude-write.js";

export interface ShellCommandRequest {
  readonly cwd: string;
  readonly command: string;
}

export type ShellRequestResult =
  | { kind: "shell"; tool: string; request: ShellCommandRequest }
  | { kind: "unsupported" }
  | { kind: "invalid"; reason: "payload-too-large" | "invalid-json" | "invalid-event" | "invalid-input" };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bash schema: https://code.claude.com/docs/en/hooks#pretooluse — `command`
 * plus optional `description`, `timeout` and `run_in_background`, none of
 * which changes what the command writes. Another tool is unsupported, not
 * invalid.
 */
export function parseClaudeBash(payload: string): ShellRequestResult {
  if (Buffer.byteLength(payload, "utf8") > MAX_WRITE_PAYLOAD_BYTES) {
    return { kind: "invalid", reason: "payload-too-large" };
  }
  let value: unknown;
  try { value = JSON.parse(payload); }
  catch { return { kind: "invalid", reason: "invalid-json" }; }
  if (!object(value) || value.hook_event_name !== "PreToolUse" || typeof value.tool_name !== "string") {
    return { kind: "invalid", reason: "invalid-event" };
  }
  if (value.tool_name !== "Bash") return { kind: "unsupported" };
  const input = value.tool_input;
  if (typeof value.cwd !== "string" || !value.cwd || !object(input) || typeof input.command !== "string") {
    return { kind: "invalid", reason: "invalid-input" };
  }
  return { kind: "shell", tool: value.tool_name, request: { cwd: value.cwd, command: input.command } };
}
