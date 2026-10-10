import { currentCommit, isRepo } from "../git.js";
import { safeText } from "../render/tui/text.js";
import { getOpenSession, intentSourceOf, type StoreOptions } from "../store.js";

/** Read-only checks before a developer is asked to declare a session. */
export async function assertStartAvailable(options: StoreOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  if (!(await isRepo(cwd))) {
    throw new Error(`Not a git repository: ${cwd}. Run session start from inside your repo.`);
  }
  const open = await getOpenSession(options);
  if (open && intentSourceOf(open) !== "captured") {
    throw new Error(`A session is already open: "${safeText(open.intent ?? "intent unknown")}". Run session stop to close it.`);
  }
  if ((await currentCommit(cwd)) === undefined) {
    throw new Error("No commits yet, so there is no base to diff against. Make one commit first.");
  }
}
