// A ratchet on file length, over every .ts file touched since master, committed
// or not. A file new since master may be at most 200 lines. A file that was
// over 200 at master's merge base may not grow past what it was; one that was
// at or under 200 may not cross it. Run from the repository root: `npm run check:size`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LIMIT = 200;
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const count = (text) => text.split("\n").filter((line, i, all) => i < all.length - 1 || line).length;
const base = git("merge-base", "master", "HEAD").trim();

/** Changed since master's merge base, plus untracked; deleted files excluded. */
function touched() {
  const files = [...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")];
  return [...new Set(files)].filter((file) => file.endsWith(".ts") && existsSync(file));
}

/** Its length at the merge base, or undefined for a file new since then. */
function before(file) {
  try { return count(git("show", `${base}:${file}`)); } catch { return undefined; }
}

let failed = false;
for (const file of touched()) {
  const now = count(readFileSync(file, "utf8"));
  const then = before(file);
  if (now <= Math.max(LIMIT, then ?? 0)) continue;
  failed = true;
  console.error(then === undefined || then <= LIMIT
    ? `${file}: ${now} lines, over ${LIMIT}. Split it before committing.`
    : `${file}: ${now} lines, up from ${then} on master. Files over ${LIMIT} may not grow; move something out first.`);
}
process.exit(failed ? 1 : 0);
