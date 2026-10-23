// `session team --html`: every synced record, written as the team report page.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { factsFor } from "../observe.js";
import { loadRates } from "../pricing.js";
import { repoIdentity, storeHome, type StoreOptions } from "../store.js";
import { buildTeamReport } from "../team/build-team-report.js";
import { loadTeamRecords } from "../team/load-team-records.js";
import { renderTeamHtml } from "../team/render-team-html.js";
import { windowSince } from "../team/since-window.js";
import { otherReposNote, splitByRepo } from "../team/split-by-repo.js";

/** Where the page goes when --out is not given. */
const DEFAULT_PAGE = "session-team.html";

/** Where the page went, and the line about other repos' sessions when any were left out. */
export interface TeamPage { file: string; note: string | undefined }

/** Writes the page for this repo's sessions in the window. */
export async function writeTeamPage(since: string, out: string | undefined, options: StoreOptions = {}): Promise<TeamPage> {
  const window = windowSince(since, new Date());
  const cwd = options.cwd ?? process.cwd();
  const { own, otherRepoSessions } = splitByRepo(await loadTeamRecords(cwd), await repoIdentity(cwd), window);
  const report = buildTeamReport(own, await factsFor(own, cwd), await loadRates(storeHome(options)), window);
  const file = path.resolve(cwd, out ?? DEFAULT_PAGE);
  const note = otherReposNote(otherRepoSessions);
  await writeFile(file, renderTeamHtml(report, note), "utf8");
  return { file, note };
}
