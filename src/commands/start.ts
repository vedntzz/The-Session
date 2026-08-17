import { attributionValues, hasAttribution, readConfig } from "../config.js";
import { changedFilesSince, currentCommit, isRepo } from "../git.js";
import { appendSession, getOpenSession, type Session, type StoreOptions } from "../store.js";

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
 * Opens a session: what the developer says they are about to do, and the
 * commit they are about to do it from. Refuses when one is already open —
 * two open sessions in a repo means neither can be attributed a diff.
 */
export async function startSession(intent: string, options: StartOptions = {}): Promise<Session> {
  const declared = intent.trim();
  if (declared === "") {
    throw new Error('No intent given. Run: session start "what you are about to do"');
  }

  const cwd = options.cwd ?? process.cwd();
  if (!(await isRepo(cwd))) {
    throw new Error(`Not a git repository: ${cwd}. Run session start from inside your repo.`);
  }

  const open = await getOpenSession(options);
  if (open) {
    throw new Error(`A session is already open: "${open.intent}". Run session stop to close it.`);
  }

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

  return appendSession(
    {
      intent: declared,
      startedAt: new Date().toISOString(),
      startCommit,
      scope: normalizeScope(options.scope),
      baseline,
      ...(hasAttribution(attribution) ? { attribution } : {}),
    },
    options,
  );
}

/**
 * The lines `session start` prints on success. The third appears only when the
 * repo declares attribution — silent confirmation that `.session.json` was
 * found and what it said, since nothing else would tell the developer.
 */
export function formatStarted(session: Session): string[] {
  const scope = session.scope.length > 0 ? session.scope.join("  ") : "none declared";
  const lines = [
    `  started  ${session.intent}  (head ${session.startCommit.slice(0, 7)})`,
    `  scope    ${scope}`,
  ];

  const declared = attributionValues(session.attribution);
  if (declared.length > 0) {
    lines.push(`  for      ${declared.join("  ")}`);
  }
  return lines;
}
