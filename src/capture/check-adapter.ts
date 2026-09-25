// One coding tool's before-a-call payload, reduced to what the write check reads.
// The check knows the tool only through this: its name for the record, and a
// parse into a file write, a shell command, a tool it does not check, or junk.
import type { ShellCommandRequest } from "./adapters/claude-bash.js";
import type { FileWriteRequest } from "./write-request.js";

export type CheckRequest =
  | { kind: "write"; tool: string; request: FileWriteRequest }
  | { kind: "shell"; tool: string; request: ShellCommandRequest }
  | { kind: "unsupported" }
  | { kind: "invalid"; reason: "payload-too-large" | "invalid-json" | "invalid-event" | "invalid-input" };

export interface CheckAdapter {
  /** Stable identifier, e.g. `claude-code`; the `agent` of every write-check event. */
  readonly name: string;
  parse(payload: string): CheckRequest;
}
