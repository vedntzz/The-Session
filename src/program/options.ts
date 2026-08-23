// What the command tree can be pointed somewhere else with, and the one flag
// spelling commander does not read for us.
import type { HookOptions } from "../commands/hook.js";
import type { ScanOptions } from "../commands/scan.js";
import type { StopOptions } from "../commands/stop.js";
import type { WeekOptions } from "../commands/week.js";
import type { Palette } from "../render/palette.js";

/** Everything the command tree can be pointed somewhere else with. */
export type ProgramOptions = StopOptions &
  WeekOptions &
  HookOptions &
  ScanOptions & {
    /**
     * How the terminal views are inked. Defaults to what this process's stdout
     * and environment call for — colour into a terminal, nothing into a pipe.
     */
    palette?: Palette;
    /**
     * Where a hook payload is read from. Defaults to this process's stdin,
     * which is where Claude Code writes it; the seam is so tests can hand one
     * over without a pipe.
     */
    stdin?: AsyncIterable<Buffer | string>;
  };

/**
 * Reads a flag written out in words: `--passive=false` as well as `--passive`.
 *
 * Commander's own `--no-passive` says the same thing, and both are accepted,
 * but the negated spelling is the one nobody guesses. Anything that is not
 * plainly one or the other is refused rather than read as false, since a
 * typo silently turning capture off is exactly the failure that would go
 * unnoticed until a week of sessions was missing.
 */
export function parseFlag(value: string): boolean {
  const wanted = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(wanted)) {
    return true;
  }
  if (["false", "no", "off", "0"].includes(wanted)) {
    return false;
  }
  throw new Error(`--passive takes true or false. Got ${value}.`);
}
