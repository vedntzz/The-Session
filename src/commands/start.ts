import { attributionValues, hasAttribution, readConfig } from "../config.js";
import { changedFilesSince, currentCommit, isRepo } from "../git.js";
import {
  appendSession,
  getOpenSession,
  type NewSession,
  type Session,
  type StoreOptions,
} from "../store.js";

/** What `session start` needs, on top of where the store lives. */
export interface StartOptions extends StoreOptions {
  /** Paths the developer expects to change. */
  scope?: string[];
}

/** Drops blanks and repeats, keeping the order the developer declared them in. */
function normalizeScope(scope: readonly string[] = []): string[] {
  const declared = new Set<string>();
  for (const entry of scope) {
    const trimmed = entry.trim();
    if (trimmed !== "") {
      declared.add(trimmed);
    }
  }
  return [...declared];
}

/**
 * Everything a session records about the repo at the instant it opens, whether
 * a person opened it or the hook did. Shared so the two cannot come to differ
 * about what a session's baseline is.
 */
async function openingFacts(cwd: string): Promise<Pick<NewSession, "startedAt" | "startCommit" | "baseline" | "attribution">> {
  // Recorded now so `stop` can diff against it. An unborn HEAD has nothing to
  // diff against, so it is better to say so than to store an empty base.
  const startCommit = await currentCommit(cwd);
  if (startCommit === undefined) {
    throw new Error("No commits yet, so there is no base to diff against. Make one commit first.");
  }

  // Whatever is already dirty is not this session's doing. Recording it now
  // is what lets `stop` subtract it back out.
  const baseline = await changedFilesSince(startCommit, cwd);

  // Read once, here, and copied into the record. A session says who it was for
  // at the time it ran, so editing `.session.json` today cannot change who
  // last quarter was billed to.
  const attribution = await readConfig(cwd);

  return {
    startedAt: new Date().toISOString(),
    startCommit,
    baseline,
    ...(hasAttribution(attribution) ? { attribution } : {}),
  };
}

/**
 * Opens a session: what the developer says they are about to do, and the
 * commit they are about to do it from. Refuses when one is already open —
 * two open sessions in a repo means neither can be attributed a diff.
 */
export async function startSession(intent: string, options: StartOptions = {}): Promise<Session> {
  const declared = intent.trim();
  const cwd = options.cwd ?? process.cwd();
  await refuseUnlessStartable(declared, cwd, options);

  return appendSession(
    {
      intent: declared,
      intentSource: "declared",
      scope: normalizeScope(options.scope),
      ...(await openingFacts(cwd)),
    },
    options,
  );
}

/** Each refusal names what is wrong and the command that fixes it. */
async function refuseUnlessStartable(
  declared: string,
  cwd: string,
  options: StartOptions,
): Promise<void> {
  if (declared === "") {
    throw new Error('No intent given. Run: session start "what you are about to do"');
  }
  if (!(await isRepo(cwd))) {
    throw new Error(`Not a git repository: ${cwd}. Run session start from inside your repo.`);
  }
  const open = await getOpenSession(options);
  if (open) {
    throw new Error(
      `A session is already open: "${describeOpen(open)}". Run session stop to close it.`,
    );
  }
}

/** How an open session is named in the message that refuses to open a second. */
function describeOpen(open: Session): string {
  return open.intent ?? "opened by the hook, no prompt yet";
}

/**
 * Opens a session nobody declared, for the editor hook: scope empty, intent
 * left null until the first prompt arrives.
 *
 * Every refusal `startSession` makes is silence here instead, because this
 * runs on somebody's editor starting rather than on a command they typed.
 * A session already open is the case the whole thing turns on — a developer
 * who ran `session start` themselves has declared an intent and a scope, and
 * opening a second session on top of it would take the diff away from the one
 * they meant. Nothing is written, and nothing is said.
 *
 * A directory that is not a repo, and a repo with no commits, are silence for
 * the same reason: there is nothing to record, and an error in that position
 * is an error in the editor every time it starts anywhere else.
 */

export async function startPassiveSession(options: StoreOptions = {}): Promise<Session | undefined> {
  const cwd = options.cwd ?? process.cwd();
  if (!(await isRepo(cwd)) || (await getOpenSession(options))) {
    return undefined;
  }
  const facts = await openingFactsOrNothing(cwd);
  if (facts === undefined) {
    return undefined;
  }

  return appendSession(
    {
      // No words yet. The first prompt is what fills this, once, and a session
      // that never sees one keeps the null: nothing was asked for.
      intent: null,
      intentSource: "captured",
      scope: [],
      ...facts,
    },
    options,
  );
}

/** Nothing rather than a throw: no commit to diff against means nothing to open. */
async function openingFactsOrNothing(
  cwd: string,
): Promise<Awaited<ReturnType<typeof openingFacts>> | undefined> {
  try {
    return await openingFacts(cwd);
  } catch {
    return undefined;
  }
}

/**
 * The lines `session start` prints on success. The third appears only when the
 * repo declares attribution — silent confirmation that `.session.json` was
 * found and what it said, since nothing else would tell the developer.
 */
export function formatStarted(session: Session): string[] {
  const scope = session.scope.length > 0 ? session.scope.join("  ") : "none declared";
  const lines = [
    `  started  ${session.intent ?? ""}  (head ${session.startCommit.slice(0, 7)})`,
    `  scope    ${scope}`,
  ];

  const declared = attributionValues(session.attribution);
  if (declared.length > 0) {
    lines.push(`  for      ${declared.join("  ")}`);
  }
  return lines;
}
