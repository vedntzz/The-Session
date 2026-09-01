// The I/O half of `render/pr.ts`: which session, what the rates are, and the
// template file if there is one.
import { readFile } from "node:fs/promises";
import { loadRates } from "../pricing.js";
import { fillTemplate, placeholderList, prParts, renderPr } from "../render/pr.js";
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
 *
 * **A file that is missing and a file that will not open are different
 * problems**, and one sentence over both sends the reader to the wrong fix.
 * `Could not read .github/pr.md` in front of somebody who typed `nope.md`
 * reads as a permissions or encoding fault, and they go looking at a file that
 * was never there; the same sentence in front of a real file reads as a typo,
 * and they retype a path that was already correct. So each case says which one
 * it is and what to do about it, and the path is in every one of them —
 * relative paths resolve against the working directory, which is the fact the
 * typo usually turns on.
 *
 * Anything else keeps the system's own reason rather than being flattened into
 * a guess: it is rare enough that the errno is more use than a sentence.
 */
async function readTemplate(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new Error(templateProblem(file, error as NodeJS.ErrnoException), { cause: error });
  }
}

/** What went wrong with the template, and what the reader does next. */
function templateProblem(file: string, error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case "ENOENT":
      return `No template at ${file}. Check the path — it is read from the directory you ran session in.`;
    case "EISDIR":
      return `${file} is a directory. --template takes a Markdown file with ${placeholderList()} in it.`;
    case "EACCES":
    case "EPERM":
      return `Cannot read the template ${file} — permission denied.`;
    default:
      return `Could not read the template ${file}: ${error.message}`;
  }
}
