// Which agent sessions a session belongs to, by the ids the editors' own hooks
// carry (SES-1, SES-2). Pure: the events are written by
// commands/agent-session.ts and folded by store/read.ts.
//
// Two things hang off this. Capture reads only these agents' transcripts, so
// two agents working in one repo at once are not each charged for both. And a
// hook closes a passive session only once the agents that opened and joined
// it have ended, never on `/clear`, and never a session somebody declared.
//
// The ids are the editors' opaque session ids — no path, no prompt, nothing
// the agent wrote. A session with none (opened before this, or by a hook that
// sent no payload) keeps the rules every older record was made under.
import type { Session } from "./store/record.js";

/** One agent session: the editor's id for it, and which tool, where the hook said. */
export interface AgentSessionRef {
  readonly id: string;
  readonly agent?: string;
}

/** An agent session starting or ending while a session was open. */
export interface AgentSessionEvent extends AgentSessionRef {
  readonly type: "agent-start" | "agent-end";
}

export interface AgentSessionState extends AgentSessionRef {
  readonly live: boolean;
}

/** UUIDs and the like. Anything else is not taken as an id, so nothing odd reaches the log or a file name. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isAgentSessionId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !value.includes("..");
}

type Joined = Pick<Session, "openedBy" | "agentEvents">;

/** Every agent session, in the order it joined, and whether it has ended since. */
export function agentSessionsOf(session: Joined): AgentSessionState[] {
  const states = new Map<string, AgentSessionState>();
  if (session.openedBy !== undefined) states.set(session.openedBy.id, { ...session.openedBy, live: true });
  for (const event of session.agentEvents ?? []) {
    const known = states.get(event.id);
    const agent = known?.agent ?? event.agent;
    states.set(event.id, { id: event.id, ...(agent === undefined ? {} : { agent }), live: event.type === "agent-start" });
  }
  return [...states.values()];
}

/** The ids capture reads, or none where the record names no agent session. */
export function agentSessionIds(session: Joined): string[] {
  return agentSessionsOf(session).map((state) => state.id);
}

/** The event that joins `ref` to the session; nothing where it is already live there. */
export function startEvent(session: Joined, ref: AgentSessionRef): AgentSessionEvent | undefined {
  const known = agentSessionsOf(session).find((state) => state.id === ref.id);
  return known?.live ? undefined : { type: "agent-start", ...ref };
}

/** The event that ends `id` on the session; nothing where it never joined or has already ended. */
export function endEvent(session: Joined, id: string): AgentSessionEvent | undefined {
  const known = agentSessionsOf(session).find((state) => state.id === id);
  return known?.live ? { type: "agent-end", id } : undefined;
}

/** What an editor's end hook says about the agent session that ended. */
export interface Ending {
  readonly sessionId?: string;
  readonly reason?: string;
}

/**
 * Whether an editor's end hook may close `session`.
 *
 * - **Never a declared or primed session.** Somebody typed `session start`;
 *   `session stop` is theirs to type. An agent exiting, or a second one in
 *   another terminal, says nothing about whether that work is done.
 * - **Never on `/clear`.** The editor ends one agent session and starts the
 *   next in the same terminal; the work goes on.
 * - **A passive session closes once no agent in it is still running** — no
 *   live agent that reports its own end, since one that never does (Codex)
 *   would hold it open for ever. Its next declared start closes it instead.
 * - **An agent that never joined it** does not close it.
 * - **A legacy session**, or an ending with no id, keeps the old rule: close.
 */
export function hookMayClose(session: Joined & Pick<Session, "intentSource">, ending: Ending,
  reportsEnd: (agent: string | undefined) => boolean): boolean {
  if ((session.intentSource ?? "declared") !== "captured" || ending.reason === "clear") return false;
  const states = agentSessionsOf(session);
  if (states.length === 0 || ending.sessionId === undefined) return true;
  if (!states.some((state) => state.id === ending.sessionId)) return false;
  return !states.some((state) => state.id !== ending.sessionId && state.live && reportsEnd(state.agent));
}
