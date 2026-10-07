import { tryGit } from "../git.js";
import { loadRates } from "../pricing.js";
import type { UiData } from "../render/tui/screen.js";
import { readSessions, repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";

/** Like `prBody`, reads recorded changes without an outcome walk or a sweep. */
export async function loadPrUi(options: StoreOptions = {}): Promise<UiData> {
  const cwd = options.cwd ?? process.cwd();
  const [sessions, rates, identity, branch] = await Promise.all([
    readSessions(options), loadRates(storeHome(options)), repoIdentity(cwd), tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  return { sessions: sessions.reverse(), rates, repo: repoName(identity),
    branch: branch?.trim() === "HEAD" ? "Detached HEAD" : branch?.trim() || "Branch unavailable" };
}
