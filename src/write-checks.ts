// What one write check answered, turned into write-check events. Pure — the
// records are written by commands/record-write-check.ts under the log's lock.
// Paths are repo-relative; reasons are static codes. Nothing the check read
// from the payload, the disk or an exception reaches an event.
import type { RawLog } from "./store.js";
import type { WriteCheckDecision, WriteCheckEvent } from "./write-check-event.js";

/** One check's answer: what the host is sent, and what the record says about it. */
export interface WriteCheckVerdict {
  /** One JSON response, or "" for silence. */
  readonly response: string;
  readonly decision: WriteCheckDecision;
  /** A static code, or violation codes joined by ",". */
  readonly reason: string;
  /** False for a tool the check does not look at: that is not a write check. */
  readonly recorded: boolean;
}

/**
 * What the check had learned by the time it answered. Filled in as it goes, so
 * a check cut off at its deadline still says what it knew; a field it never
 * reached stays absent.
 */
export interface CheckProgress {
  tool?: string;
  /** Repo-relative paths the check resolved. */
  paths?: readonly string[];
  /** The session the check selected and its canonical checkout; `null`: none open here. */
  session?: { readonly id: string; readonly checkout: string } | null;
}

/**
 * The session's next number: one past the highest `n` any tool-call or
 * write-check record for it holds. One counter, so a number names one event.
 */
export function nextEventNumber(log: RawLog, sessionId: string): number {
  let max = 0;
  for (const line of log.lines) {
    let record: { id?: unknown; set?: Record<string, { n?: unknown } | undefined> };
    try { record = JSON.parse(line.text); } catch { continue; }
    if (record?.id !== sessionId || typeof record.set !== "object" || record.set === null) continue;
    for (const key of ["toolCallStart", "toolCallEnd", "writeCheck"]) {
      const n = record.set[key]?.n;
      if (typeof n === "number" && Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

/**
 * The events for one check, before they are numbered: one per path it
 * resolved, all carrying the check's answer. A check that resolved no path —
 * its input unread, its command's writes unknown, its target blocked, or
 * record-only — is one event with `path: null`: not known. `tool` is `null`
 * when the payload was never read. Unknown is never an empty string.
 */
export function writeCheckEvents(
  verdict: WriteCheckVerdict, progress: CheckProgress, agent: string,
): Omit<WriteCheckEvent, "n">[] {
  const base = { type: "write-check" as const, tool: progress.tool ?? null, decision: verdict.decision, reason: verdict.reason, agent };
  const paths = [...new Set(progress.paths ?? [])];
  return paths.length === 0 ? [{ ...base, path: null }] : paths.map((path) => ({ ...base, path }));
}
