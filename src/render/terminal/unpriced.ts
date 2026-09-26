// The week's note on sessions it could not price: models no rate covers, and reasons no rate would fix.
import type { Spend } from "../../pricing.js";
import { CACHE_WRITE_REASON } from "../../pricing-turns.js";
import type { Palette } from "../palette.js";
import { RATES_HINT, stubLines } from "./cost.js";
import { note, plural } from "./text.js";

/** Reasons a session is unpriced that a rate cannot fix; everything else in `unpricedModels` is a model. */
const REASONS: ReadonlySet<string> = new Set([CACHE_WRITE_REASON]);

/**
 * Sessions whose model no rate covers, and the file that would fix them.
 *
 * The stub is not wrapped: it is JSON the reader is meant to copy into a file,
 * and a line break through the middle of it is one they would have to take
 * back out. A reason gets no stub, since no rate would fix it.
 */
export function unpricedNotes(spend: Spend, palette: Palette, limit?: number): string[] {
  if (spend.unpriced === 0) {
    return [];
  }
  const sessions = plural(spend.unpriced, "session", "sessions");
  const models = spend.unpricedModels.filter((name) => !REASONS.has(name));
  const fix = models.length === 0 ? "" : ` — save this as ${RATES_HINT}`;
  const what = `${sessions} unpriced: ${spend.unpricedModels.join(", ")}${fix}`;
  return [...note(what, palette.meta, limit), ...(models.length === 0 ? [] : stubLines(models, palette))];
}
