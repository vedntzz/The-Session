// PreToolUse boundary. Never grants permission or echoes tool content. What it
// answered is written to the chain as a write-check event (write-checks.ts).
import { parseAgreement } from "../agreement.js";
import { decideAgreementWrite, type AgreementWrite } from "../agreement-decision.js";
import { claudeCheckAdapter } from "../capture/adapters/claude-check.js";
import { MAX_WRITE_PAYLOAD_BYTES } from "../capture/adapters/claude-write.js";
import type { CheckAdapter } from "../capture/check-adapter.js";
import { repoRoot } from "../git.js";
import { realpath } from "node:fs/promises";
import { readSessions, type StoreOptions } from "../store.js";
import type { CheckProgress, WriteCheckVerdict } from "../write-checks.js";
import { selectWriteSession, WriteSessionSelectionError } from "../write-session.js";
import { recordWriteCheck } from "./record-write-check.js";
import { resolveShellCommand } from "./resolve-shell.js";
import { resolveFileWrite } from "./resolve-write.js";

export type CheckWriteOptions = StoreOptions & {
  stdin?: AsyncIterable<Buffer | string>;
  /** How long the check may take before it denies. Defaults to CHECK_DEADLINE_MS. */
  deadlineMs?: number;
  /** How long recording the answer may take. Defaults to RECORD_DEADLINE_MS. */
  recordMs?: number;
  /** The coding tool whose payloads are read. Defaults to Claude Code's. */
  adapter?: CheckAdapter;
};

/**
 * Half the hook's registered timeout. The host lets a timed-out PreToolUse hook
 * through, so a check that stalls must answer for itself before the host stops
 * waiting — a denial it can give, where silence from a killed process is an allow.
 */
export const CHECK_DEADLINE_MS = 5_000;

/** Empty output leaves the editor's own permissions intact; never emit allow. */
function response(decision: "ask" | "deny", reason: string): string {
  return JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason,
  } });
}

const verdict = (decision: "ask" | "deny", text: string, reason: string): WriteCheckVerdict =>
  ({ response: response(decision, text), decision, reason, recorded: true });
const silent = (reason: string, recorded = true): WriteCheckVerdict =>
  ({ response: "", decision: "silent", reason, recorded });

async function payloadFrom(input: AsyncIterable<Buffer | string>): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    bytes += buffer.byteLength;
    if (bytes > MAX_WRITE_PAYLOAD_BYTES) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The check, bounded in time. Whichever finishes first answers: the check, or
 * a denial at the deadline. Work still in flight is abandoned, not trusted —
 * the deadline's event says `not-checked`, with what the check knew by then.
 */
export async function checkWrite(options: CheckWriteOptions = {}): Promise<string> {
  const adapter = options.adapter ?? claudeCheckAdapter;
  const progress: CheckProgress = {};
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<WriteCheckVerdict>((resolve) => {
    timer = setTimeout(() => resolve({
      response: response("deny", "Write check did not finish in time. Check the repository and session log, then retry."),
      decision: "not-checked", reason: "deadline", recorded: true,
    }), options.deadlineMs ?? CHECK_DEADLINE_MS);
  });
  let answer: WriteCheckVerdict;
  try {
    answer = await Promise.race([evaluate(options, adapter, progress), deadline]);
  } finally {
    clearTimeout(timer);
  }
  // A copy: abandoned work must not change what the event says it knew.
  await recordWriteCheck(answer, { ...progress }, adapter.name, options, options.recordMs);
  return answer.response;
}

/**
 * The process cwd selects the checkout, never the untrusted payload cwd.
 * Caught failures produce a denial, not an exit-1 that the host may ignore.
 */
async function evaluate(options: CheckWriteOptions, adapter: CheckAdapter, progress: CheckProgress): Promise<WriteCheckVerdict> {
  try {
    const payload = await payloadFrom(options.stdin ?? process.stdin);
    if (payload === undefined) return verdict("deny", "Write check input exceeds 2 MiB. Reduce the tool payload and retry.", "payload-too-large");
    const parsed = adapter.parse(payload);
    if (parsed.kind === "unsupported") return silent("unsupported-tool", false);
    if (parsed.kind === "invalid") return verdict("deny", "Write check received invalid input. Check the PreToolUse hook configuration and retry.", parsed.reason);
    progress.tool = parsed.tool;

    const cwd = await realpath(await repoRoot(options.cwd ?? process.cwd()));
    const session = selectWriteSession(await readSessions({ ...options, cwd }), cwd);
    progress.session = session ? { id: session.id, checkout: cwd } : null;
    if (session?.agreement === undefined) return silent("no-agreement");
    const agreement = parseAgreement(session.agreement);
    if (agreement.policy === "record") return silent("record-only");
    const resolved = parsed.kind === "write"
      ? await resolveFileWrite(parsed.request, cwd)
      : await resolveShellCommand(parsed.request.command, parsed.request.cwd, cwd);
    if (resolved.kind === "unknown") {
      // Not a denial: nothing says the command breaks the terms, only that
      // nothing can say it keeps them. The developer answers, per command.
      return verdict("ask", "Can't tell what this writes. Review the command before it runs.", "unknown-writes");
    }
    if (resolved.kind === "blocked") {
      return verdict("deny", `Write target could not be checked (${resolved.reason}). Check the target path and retry.`, resolved.reason);
    }
    progress.paths = resolved.writes.map((write) => write.path);
    return decide(agreement, resolved.writes);
  } catch (error) {
    // Selection failed: there is no one session to record against.
    if (error instanceof WriteSessionSelectionError) return { ...verdict("deny", error.message, "session-selection"), recorded: false };
    return verdict("deny", "Write check could not read its input, repository or agreement. Check the local hook setup and session log before retrying.", "check-failed");
  }
}

/** Every write decided, the strictest kept. No writes, or all compliant, is silence. */
function decide(agreement: ReturnType<typeof parseAgreement>, writes: readonly AgreementWrite[]): WriteCheckVerdict {
  const decisions = writes.map((write) => decideAgreementWrite(agreement, write));
  const decision = decisions.some((item) => item.decision === "deny") ? "deny"
    : decisions.some((item) => item.decision === "ask") ? "ask" : undefined;
  // Internal defer means no decision. The host's literal defer pauses a run.
  if (decision === undefined) return silent(writes.length === 0 ? "no-writes" : "compliant");
  const violations = [...new Set(decisions.flatMap((item) => item.violations))];
  return verdict(decision, `Attempted write conflicts with the accepted agreement (${violations.join(", ")}). Review the attempted write before proceeding.`, violations.join(","));
}
