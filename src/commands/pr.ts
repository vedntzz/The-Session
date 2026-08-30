// The I/O half of `render/pr.ts`: which session, what the rates are, and the
// template file if there is one.
import { readFile } from "node:fs/promises";
import { loadRates } from "../pricing.js";
import { fillTemplate, prParts, renderPr } from "../render/pr.js";
import { pickSession } from "./show.js";
import { storeHome, type StoreOptions } from "../store.js";

/**
 * The pull request body for one session.
 *
 * No sweep and no outcome. Every other read command settles what it can on the
 * way past, and this one deliberately does not: the document goes to stdout to
 * be piped into `gh pr create --body-file -`, and a sweep's notice above the
 * heading would be a line in somebody's pull request. `pickSession` is the
 * light half of `showSession` for the same reason — the work has not landed
 * yet, so there is no outcome worth walking the branch's history for.
 */
export async function prBody(
  id: string | undefined,
  options: StoreOptions = {},
  template?: string,
): Promise<string> {
  const session = await pickSession(id, options);
  const rates = await loadRates(storeHome(options));

  if (template === undefined) {
    return renderPr(session, rates);
  }
  return fillTemplate(await readTemplate(template), prParts(session, rates), template);
}

/**
 * The template file, or what to do about not having one.
 *
 * Named in the error, because the path is the whole of what went wrong: a
 * `--template` pointing at a file that is not there is a typo, and the fix is
 * to see which path was actually looked for.
 */
async function readTemplate(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Could not read the template ${file}.`, { cause: error });
  }
}
