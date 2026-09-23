// One line per tool call, for `week <id> --full`. Pure and plain; ink is the
// caller's. A call that cannot say what it changed reads `unattributed`, with
// why — never "no change", which would be a nought standing in for unknown.
import type { ToolCall } from "../../tool-calls.js";

export const UNATTRIBUTED = "unattributed";
export const NO_CHANGE = "no change";

/** Why a call is unattributed, in the reader's terms. */
const WHY = {
  overlapping: "ran while another call was running",
  unpaired: "no start was recorded",
} as const;

/** `call 3  Edit  changed during tool call 3: src/a.ts  src/b.ts`, or its absence. */
export function callLine(call: ToolCall): string {
  const head = `call ${call.n}  ${call.tool}`;
  const end = call.end;
  if (!end) return `${head}  still running`;
  if (end.changed === null) {
    return `${head}  ${UNATTRIBUTED} — ${end.unpaired ? WHY.unpaired : WHY.overlapping}`;
  }
  if (!end.changed) return `${head}  ${NO_CHANGE}`;
  return `${head}  changed during tool call ${call.n}: ${end.files.map((file) => file.path).join("  ")}`;
}
