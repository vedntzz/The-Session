// What the editors' start hooks do once they name their agent session
// (SES-2): open a passive session that remembers who opened it, or join a
// session already open in this checkout. A hook that sends no payload keeps
// the old behaviour exactly, and so does a person typing the same command.
import { realpath } from "node:fs/promises";
import { startEvent, type AgentSessionEvent, type AgentSessionRef } from "../agent-sessions.js";
import type { HookPayload } from "../capture/adapters/hook-payload.js";
import { repoRoot } from "../git.js";
import { foldLog, getOpenSession, writeRecordFrom, type Session, type StoreOptions } from "../store.js";
import { startPassiveSession } from "./start.js";

/** Appends one agent-session event, decided against the session as the log holds it under the lock. */
async function recordEvent(
  session: Session, decide: (current: Session) => AgentSessionEvent | undefined, options: StoreOptions,
): Promise<void> {
  await writeRecordFrom(options, (log) => {
    const current = foldLog(log).find((item) => item.id === session.id) ?? session;
    const event = current.endedAt === null ? decide(current) : undefined;
    return event && { id: session.id, set: { agentSession: event } };
  });
}

/** The open session, only where it is this checkout's: a worktree sharing the remote shares the log. */
async function openHere(options: StoreOptions): Promise<Session | undefined> {
  const open = await getOpenSession(options);
  if (open === undefined) return undefined;
  const here = await realpath(await repoRoot(options.cwd ?? process.cwd())).catch(() => undefined);
  return open.checkout === undefined || open.checkout === here ? open : undefined;
}

/**
 * `start --passive` from a start hook: join the session open in this checkout,
 * or open a passive one naming the agent session that opened it. Nothing is
 * printed either way; the hook's stdout reaches the agent.
 */
export async function startFromHook(options: StoreOptions, payload: HookPayload | undefined, agent?: string): Promise<void> {
  const ref: AgentSessionRef | undefined = payload?.sessionId === undefined ? undefined
    : { id: payload.sessionId, ...(agent === undefined ? {} : { agent }) };
  const open = await getOpenSession(options);
  if (open !== undefined) {
    const here = await openHere(options);
    if (ref !== undefined && here !== undefined) await recordEvent(here, (current) => startEvent(current, ref), options);
    return;
  }
  await startPassiveSession({ ...options, ...(ref === undefined ? {} : { openedBy: ref }) });
}
