// `session team`.
import type { Command } from "commander";
import { writeTeamPage } from "../commands/team.js";
import type { ProgramOptions } from "./options.js";

/** What `session team` accepts, as commander hands it over. */
export type TeamFlags = { html?: boolean; out?: string; since: string };

/** `session team --html` — the team report page from every synced record. */
export function registerTeam(program: Command, options: ProgramOptions): void {
  program
    .command("team")
    .description("Write the team report page from every synced session record")
    .option("--html", "write the report as a self-contained HTML page")
    .option("--out <path>", "write it here instead of ./session-team.html")
    .option("--since <window>", "how far back: 7d, 30d or 90d", "30d")
    .action(async (flags: TeamFlags) => {
      if (flags.html !== true) throw new Error("--html is required for now. Run session team --html.");
      const { file, note } = await writeTeamPage(flags.since, flags.out, options);
      console.log(`  wrote    ${file}`);
      if (note !== undefined) console.log(`  ${note}`);
    });
}
