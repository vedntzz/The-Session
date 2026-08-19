import { withOutcomes } from "../observe.js";
import type { Home } from "../render/terminal.js";
import { readSessions, type StoreOptions } from "../store.js";

/**
 * Where the repo stands, for the bare `session` screen.
 *
 * Two facts and nothing else: whether something is recording right now, and
 * the last session that finished. That is the whole of what the screen says,
 * and gathering more would be reading the log twice for lines nobody prints.
 *
 * A repo with no log at all is not an error here. Typing `session` is how
 * somebody finds out what this is; answering an empty repo with a stack trace
 * would be answering the question badly.
 */
export async function homeState(options: StoreOptions = {}): Promise<Home> {
  const sessions = await readSessions(options);

  const running = sessions.filter((session) => session.endedAt === null).at(-1);
  const last = sessions.filter((session) => session.endedAt !== null).at(-1);
  if (!last) {
    return running ? { running } : {};
  }

  // The outcome is resolved for the one session the screen names, the same way
  // `show` resolves it: the field on disk is only what `settle` last wrote.
  const [resolved] = await withOutcomes([last], options.cwd ?? process.cwd());
  return { ...(running ? { running } : {}), last: resolved ?? last };
}
