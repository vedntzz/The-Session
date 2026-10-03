// Which agent sessions a session belongs to, by the ids the editors' own hooks
// carry (SES-1, SES-2). Pure: the events are written by
// commands/agent-session.ts and folded by store/read.ts.
//
// Capture reads only these agents' transcripts, so two agents working in one
// repo at once are not each charged for both.
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
