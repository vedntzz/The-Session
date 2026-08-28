// The command tree: this file assembles it, `program/` holds one file per
// command. Kept apart so a command's flags, its action and its output live
// together rather than in a thousand-line switchboard.
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { paletteFor, type Palette } from "./render/palette.js";
import { configureHelp, registerHelp } from "./program/help.js";
import { registerConfig } from "./program/config.js";
import { registerDebt } from "./program/debt.js";
import { registerEstimate } from "./program/estimate.js";
import { registerHome } from "./program/home.js";
import { registerHook } from "./program/hook.js";
import { registerIntent } from "./program/intent.js";
import { registerKey } from "./program/key.js";
import { registerScan } from "./program/scan.js";
import { registerSettle } from "./program/settle.js";
import { registerShow } from "./program/show.js";
import { registerStart } from "./program/start.js";
import { registerStop } from "./program/stop.js";
import { registerSync } from "./program/sync.js";
import { registerVerify } from "./program/verify.js";
import { registerWeek } from "./program/week.js";
import type { ProgramOptions } from "./program/options.js";

export { parseFlag, type ProgramOptions } from "./program/options.js";

/**
 * The version the package was published as, read off the manifest.
 *
 * Read rather than pasted. A version written out here as well is a version
 * that will be bumped in one place and not the other — `npm version` writes
 * the manifest and nothing else, so the copy here would go stale at the next
 * release and the CLI would misreport itself to whoever was filing the bug.
 *
 * Resolved against this module, never the working directory: `session` is
 * usually a global install being run from inside somebody else's repo, and
 * the `package.json` in front of it there is theirs. Same `../` as
 * `bundledRatesFile` — one level up from `dist/` when installed, one level up
 * from `src/` when run from a checkout.
 *
 * Read once, at import: `buildProgram` is called per command and, in the
 * tests, a hundred times over.
 *
 * Nothing catches a failure here. The manifest ships inside the package, so a
 * missing one is a broken install rather than a missing option, and the
 * alternative — falling back to some placeholder string — would report a
 * confidently wrong version, which is the whole defect this replaced.
 */
const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

/**
 * Builds the `session` command tree. Kept separate from the executable entry
 * point so tests can drive it without spawning a process; `options` is the
 * seam that lets them point the store somewhere temporary.
 */
export function buildProgram(options: ProgramOptions = {}): Command {
  const program = new Command();
  // Decided once, here, rather than per command: whether stdout is a terminal
  // does not change between two lines of the same run.
  const palette = options.palette ?? paletteFor();

  program
    .name("session")
    .description("Record what an AI coding session declared, what it changed, and what it cost")
    .version(VERSION);

  registerHome(program, options, palette);
  // Commander adds its own `help [command]`, which would collide with the one
  // registered at the bottom of this function.
  program.helpCommand(false);
  configureHelp(program);

  registerCommands(program, options, palette);

  return program;
}

/**
 * The rest of the tree, in the order `session help all` lists them — which is
 * registration order, since that list is read off the tree itself.
 */
function registerCommands(program: Command, options: ProgramOptions, palette: Palette): void {
  registerStart(program, options);
  registerIntent(program, options);
  registerStop(program, options);
  registerShow(program, options, palette);
  registerWeek(program, options, palette);
  registerScan(program, options, palette);
  registerDebt(program, options, palette);
  registerEstimate(program, options);
  registerVerify(program, options);
  registerSettle(program, options);
  registerSync(program, options);
  registerConfig(program, options);
  registerKey(program, options);
  registerHook(program, options);
  // Registered last, so it comes last in the short list: it is where a reader
  // goes when the two commands above are not the ones they wanted.
  registerHelp(program, palette);
}
