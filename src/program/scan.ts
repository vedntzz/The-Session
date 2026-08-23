// `session scan`.
import type { Command } from "commander";
import {
  DEFAULT_SCAN_DAYS,
  parseScanDays,
  scanSessions,
  transcriptsExist,
} from "../commands/scan.js";
import { loadRates } from "../pricing.js";
import { renderWeek } from "../render/html.js";
import type { Palette } from "../render/palette.js";
import { formatScan } from "../render/terminal.js";
import type { ScannedSession } from "../scan.js";
import { storeHome, type Session } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";
import { emitWeekPage } from "./week.js";

/**
 * `session scan` — what the transcripts already on disk cost, for somebody who
 * has recorded nothing.
 *
 * The one command that answers before the tool has been adopted: no `session
 * start`, no hook, no `~/.session`, nothing to set up. It reads, prices, and
 * prints. It writes no record, which is what makes it safe to run on a machine
 * that has never seen this tool and may never see it again.
 */
export function registerScan(program: Command, options: ProgramOptions, palette: Palette): void {
  program
    .command("scan")
    .description("What the agent sessions already on this machine have cost — no setup needed")
    .option("--days <n>", `how far back to look (default ${DEFAULT_SCAN_DAYS})`)
    .option("--repo <path>", "only sessions that ran in this checkout")
    .option("--open", "write the scan as an HTML page and open it")
    .action((flags: ScanFlags) => emitScan(flags, options, palette));
}

interface ScanFlags {
  days?: string;
  repo?: string;
  open?: boolean;
}

/** Reads the transcripts once, then hands them to whichever rendering was asked for. */
async function emitScan(
  flags: ScanFlags,
  options: ProgramOptions,
  palette: Palette,
): Promise<void> {
  const days = parseScanDays(flags.days);
  if (!(await transcriptsExist(options))) {
    printLines(["", `${SCAN_INDENT}${NO_TRANSCRIPTS}`]);
    return;
  }

  const rates = await loadRates(storeHome(options));
  const { report, sessions } = await scanSessions(days, rates, {
    ...options,
    repo: flags.repo ?? options.repo,
  });

  if (flags.open) {
    await emitWeekPage(renderWeek(asSessions(sessions), days, {}, { rates }), options);
    return;
  }
  printLines(formatScan(report, palette));
}

export const SCAN_INDENT = "  ";

/** What to say on a machine where the agent has never run. */
export const NO_TRANSCRIPTS =
  "No Claude Code transcripts on this machine — nothing to scan. " +
  "Looked in ~/.claude/projects.";

/**
 * Scanned sessions in the shape the HTML page renders.
 *
 * Built here and thrown away: nothing is written, and these never reach the
 * store. `week --open` and `scan --open` are the same page because they answer
 * the same question, and a second renderer would be a second set of totals to
 * keep in agreement with the first.
 *
 * Three fields are deliberately empty and one is deliberately `open`. A scan
 * sees a transcript and no diff, so it knows of no scope, no changed paths and
 * no drift, and it cannot settle an outcome: `merged` in this tool means the
 * blob a session left is in the default branch's history, which is evidence
 * `scan` does not have. The report's own view says how many sessions
 * overlapped a commit, in those words. Filling this cell in from that would
 * put a claim on the page that the terminal is careful not to make.
 */
export function asSessions(scanned: readonly ScannedSession[]): Session[] {
  return scanned.map((session) => ({
    id: session.id,
    repo: session.repo,
    intent: session.label,
    // True by construction: these words were typed at the agent, not declared
    // to this tool before the work.
    intentSource: "captured" as const,
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: session.cost,
    outcome: "open" as const,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    startCommit: "",
  }));
}
