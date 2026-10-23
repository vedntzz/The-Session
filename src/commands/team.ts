// `session team --html`: every synced record, written as the team report page.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { factsFor } from "../observe.js";
import { loadRates } from "../pricing.js";
import { storeHome, type StoreOptions } from "../store.js";
import { buildTeamReport } from "../team/build-team-report.js";
import { loadTeamRecords } from "../team/load-team-records.js";
import { renderTeamHtml } from "../team/render-team-html.js";
import { windowSince } from "../team/since-window.js";

/** Where the page goes when --out is not given. */
const DEFAULT_PAGE = "session-team.html";

/** Writes the page for the window and returns where it went. */
export async function writeTeamPage(since: string, out: string | undefined, options: StoreOptions = {}): Promise<string> {
  const window = windowSince(since, new Date());
  const cwd = options.cwd ?? process.cwd();
  const records = await loadTeamRecords(cwd);
  const report = buildTeamReport(records, await factsFor(records, cwd), await loadRates(storeHome(options)), window);
  const file = path.resolve(cwd, out ?? DEFAULT_PAGE);
  await writeFile(file, renderTeamHtml(report), "utf8");
  return file;
}
