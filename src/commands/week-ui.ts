import { tryGit } from "../git.js";
import { loadChecked } from "../pricing.js";
import { INTENT_SOURCES, intentSourceOf, type StoreOptions } from "../store.js";
import { loadUi } from "./ui.js";
import { DEFAULT_DAYS } from "./week.js";

/** Same rolling window and live outcomes as week; source order only changes presentation. */
export async function loadWeekUi(days = DEFAULT_DAYS, options: StoreOptions = {}): ReturnType<typeof loadUi> {
  const [data, branch, checked] = await Promise.all([
    loadUi(days, options), tryGit(options.cwd ?? process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"]), loadChecked(),
  ]);
  data.sessions.sort((a, b) => INTENT_SOURCES.indexOf(intentSourceOf(a)) - INTENT_SOURCES.indexOf(intentSourceOf(b)));
  return { ...data, checked, branch: branch?.trim() === "HEAD" ? "Detached HEAD" : branch?.trim() || "Branch unavailable" };
}
