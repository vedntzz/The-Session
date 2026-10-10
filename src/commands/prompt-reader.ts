import { createInterface, type Interface } from "node:readline";
import type { PromptTerminal } from "./prompt-terminal.js";

export function createPromptReader(terminal: PromptTerminal): Interface {
  return createInterface({
    input: terminal.input,
    output: terminal.output,
    terminal: false,
    crlfDelay: Infinity,
  });
}
