// Fails if any .ts file touched since master, committed or not, is over 200 lines.
// Run from the repository root: `npm run check:size`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LIMIT = 200;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);

/** Changed since master's merge base, plus untracked; deleted files excluded. */
function touched() {
  const base = git("merge-base", "master", "HEAD")[0];
  const files = [...git("diff", "--name-only", base), ...git("ls-files", "--others", "--exclude-standard")];
  return [...new Set(files)].filter((file) => file.endsWith(".ts") && existsSync(file));
}

const lines = (file) => readFileSync(file, "utf8").split("\n").filter((line, i, all) => i < all.length - 1 || line).length;
const over = touched().map((file) => [file, lines(file)]).filter(([, count]) => count > LIMIT);

for (const [file, count] of over) console.error(`${file}: ${count} lines, over ${LIMIT}. Split it before committing.`);
process.exit(over.length > 0 ? 1 : 0);
