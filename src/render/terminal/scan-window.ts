import type { ScanReport } from "../../scan.js";
import { plural } from "./text.js";

/** What was read, under the headline computed from it. */
export function scanWindow(report: ScanReport): string {
  return `the last ${plural(report.days, "day", "days")} · ${plural(report.repos.length, "repo", "repos")}`;
}

