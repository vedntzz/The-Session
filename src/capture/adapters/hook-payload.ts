// The little an editor's session hooks say about themselves (SES-1, SES-2).
// Claude Code sends JSON on stdin with `session_id` and, for a start, `source`
// or, for an end, `reason`. Nothing else is kept: no transcript path, no cwd.
import { isAgentSessionId } from "../../agent-sessions.js";

export interface HookPayload {
  /** The editor's id for the agent session, where it sent a usable one. */
  readonly sessionId?: string;
  /** Why it started (`startup`, `resume`, `clear`, `compact`) or ended (`clear`, `logout`, …). */
  readonly reason?: string;
}

const WORD = /^[a-z_]{1,32}$/;

/** A payload's fields, or undefined where it is not a hook's JSON at all: a person typing the command. */
export function parseHookPayload(text: string): HookPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const fields = parsed as Record<string, unknown>;
  if (typeof fields["hook_event_name"] !== "string") return undefined;
  const reason = fields["reason"] ?? fields["source"];
  return {
    ...(isAgentSessionId(fields["session_id"]) ? { sessionId: fields["session_id"] } : {}),
    ...(typeof reason === "string" && WORD.test(reason) ? { reason } : {}),
  };
}

/**
 * How long a hook's stdin is waited on when nothing has arrived. An editor
 * writes the payload before the hook process has even started, so it is
 * there to read at once; this only bounds the wait where nothing will come.
 * Missing a payload that came later is the old behaviour, never a worse one.
 */
export const PAYLOAD_WAIT_MS = 250;

/**
 * The hook's payload, or undefined where there is none to read: at a terminal,
 * where waiting on stdin would hang a person's command, or from a runner that
 * leaves stdin open and sends nothing. Reading stops at the end of the stream
 * or as soon as what arrived is a whole payload, whichever is first.
 */
export async function hookPayloadFrom(
  stdin: AsyncIterable<Buffer | string> | undefined, waitMs = PAYLOAD_WAIT_MS,
): Promise<HookPayload | undefined> {
  const stream = stdin ?? (process.stdin.isTTY ? undefined : process.stdin);
  if (stream === undefined) return undefined;
  let text = "";
  const read = (async () => {
    for await (const chunk of stream) {
      text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (parseHookPayload(text) !== undefined) return;
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); });
  await Promise.race([read.catch(() => undefined), late]);
  clearTimeout(timer);
  if (stream === process.stdin) process.stdin.pause();
  return parseHookPayload(text);
}
