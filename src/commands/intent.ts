import { captureIntent, getOpenSession, type Session, type StoreOptions } from "../store.js";

/**
 * The first prompt of a passively opened session, written down as its intent.
 *
 * This is the half of passive capture that makes a hook-opened session worth
 * anything: a record with no intent is half a record. It runs on the prompt
 * itself rather than at `stop`, so the words are on the log before the agent
 * has done anything — the ordering invariant 1 is about. An intent extracted
 * afterwards from the same transcript would hold the same words but would have
 * been written by something that had already seen the result.
 *
 * Once written it is exactly as immutable as a declared one. Every prompt
 * after the first finds an intent already there and does nothing at all, which
 * is also the common case: this runs on every prompt in the session.
 */

/**
 * How much of a prompt is kept. Generous enough for a paragraph, short enough
 * that a pasted stack trace cannot turn the log into something no view can
 * print. What is cut is not lost — the transcript holds the prompt in full;
 * this is the log's copy of it, and the cut is marked.
 */
export const MAX_INTENT = 500;

/** Marks a prompt that was longer than the record keeps. */
const ELLIPSIS = "…";

/**
 * A prompt as an intent, or nothing when there is no intent in it.
 *
 * Runs of whitespace become single spaces. That is the one liberty taken with
 * somebody's words, and it is taken because a record is a line: an intent with
 * newlines in it would break every view that prints one. Nothing else is
 * rewritten — no summarising, no rephrasing, and nothing asked of a model.
 * These are the developer's words or they are not their intent.
 */
export function intentFromPrompt(prompt: string): string | undefined {
  const flattened = prompt.replace(/\s+/gu, " ").trim();
  if (flattened === "") {
    return undefined;
  }

  const characters = [...flattened];
  if (characters.length <= MAX_INTENT) {
    return flattened;
  }
  return `${characters.slice(0, MAX_INTENT - 1).join("")}${ELLIPSIS}`;
}

/**
 * Writes the prompt as the open session's intent, or does nothing.
 *
 * Nothing happens, and nothing is said, in every case but one: an open session
 * that was opened passively and has not been given words yet. A session the
 * developer declared already has an intent and keeps it; so does a passive
 * session past its first prompt.
 */
export async function captureFromPrompt(
  prompt: string,
  options: StoreOptions = {},
): Promise<Session | undefined> {
  const open = await getOpenSession(options);
  if (!open || open.intent !== null) {
    return undefined;
  }

  const intent = intentFromPrompt(prompt);
  if (intent === undefined) {
    return undefined; // an empty prompt declares nothing; the next one may
  }

  return captureIntent(open.id, intent, options);
}

/**
 * The prompt out of a Claude Code hook payload, or nothing when there is none
 * in it.
 *
 * Anything unrecognisable reads as nothing rather than as an error. This is
 * parsing somebody else's JSON on the way past a keystroke: a payload that
 * grew a field, or a hook wired up by hand to something else, must leave the
 * editor exactly as it found it.
 */
export function promptFromHook(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const prompt = (parsed as Record<string, unknown>)["prompt"];
  return typeof prompt === "string" ? prompt : undefined;
}

/** Reads the hook's payload off a stream. Nothing on it is nothing to do. */
export async function readHookPayload(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return chunks.join("");
}
