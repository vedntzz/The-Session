import type { Readable, Writable } from "node:stream";

export interface PromptTerminal {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean; columns?: number };
}
