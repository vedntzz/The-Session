// Read-only PreToolUse boundary. Never grants permission or echoes tool content.
import { parseAgreement } from "../agreement.js";
import { decideAgreementWrite } from "../agreement-decision.js";
import { MAX_WRITE_PAYLOAD_BYTES, parseClaudeWrite } from "../capture/adapters/claude-write.js";
import { repoRoot } from "../git.js";
import { getOpenSession, type StoreOptions } from "../store.js";
import { resolveFileWrite } from "./resolve-write.js";

export type CheckWriteOptions = StoreOptions & { stdin?: AsyncIterable<Buffer | string> };

/** Empty output leaves the editor's own permissions intact; never emit allow. */
function response(decision: "ask" | "deny", reason: string): string {
  return JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason,
  } });
}

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
 * The process cwd selects the checkout, never the untrusted payload cwd.
 * Caught failures produce a denial, not an exit-1 that the host may ignore.
 * Installation and host timeout behavior are deliberately separate concerns.
 */
export async function checkWrite(options: CheckWriteOptions = {}): Promise<string> {
  try {
    const payload = await payloadFrom(options.stdin ?? process.stdin);
    if (payload === undefined) return response("deny", "Write check input exceeds 2 MiB. Reduce the tool payload and retry.");
    const parsed = parseClaudeWrite(payload);
    if (parsed.kind === "unsupported") return "";
    if (parsed.kind === "invalid") return response("deny", "Write check received invalid input. Check the PreToolUse hook configuration and retry.");

    const cwd = await repoRoot(options.cwd ?? process.cwd());
    const session = await getOpenSession({ ...options, cwd });
    if (session?.agreement === undefined) return "";
    const agreement = parseAgreement(session.agreement);
    if (agreement.policy === "record") return "";
    const resolved = await resolveFileWrite(parsed.request, cwd);
    if (resolved.kind === "blocked") {
      return response("deny", `Write target could not be checked (${resolved.reason}). Check the target path and retry.`);
    }
    const decisions = resolved.writes.map((write) => decideAgreementWrite(agreement, write));
    const decision = decisions.some((item) => item.decision === "deny") ? "deny"
      : decisions.some((item) => item.decision === "ask") ? "ask" : "defer";
    // Internal defer means no decision. The host's literal defer pauses a run.
    if (decision === "defer") return "";
    const violations = [...new Set(decisions.flatMap((item) => item.violations))];
    return response(decision, `Attempted write conflicts with the accepted agreement (${violations.join(", ")}). Review the attempted write before proceeding.`);
  } catch {
    return response("deny", "Write check could not read its input, repository or agreement. Check the local hook setup and session log before retrying.");
  }
}
