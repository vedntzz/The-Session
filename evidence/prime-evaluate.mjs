// Walk-forward evaluation of the current rule. Run after npm run build.
// Usage: node evidence/prime-evaluate.mjs [checkout]
// Historical trees come from each target's start commit, never today's tree.
import { execFileSync } from "node:child_process";
import { readSessions, repoIdentity, intentSourceOf } from "../dist/store.js";
import { proposeScope } from "../dist/prime.js";

const cwd = process.argv[2] ?? process.cwd();
const all = await readSessions({ cwd });
const repo = await repoIdentity(cwd);
const targets = all.filter((s) => s.endedAt !== null && intentSourceOf(s) === "declared" && s.intent);
console.log("# Prime walk-forward evaluation\n");
console.log("Exact tracked files only. History must close before the target starts. No current-tree fallback.");
console.log("Seeded rows use paths declared before the target ran; their coverage is not a measure of prediction alone.");
console.log("Precision = proposed files that changed / proposed files. Recall = changed files proposed / all changed files.");
console.log("Abstentions have no precision; sessions that changed nothing have no recall.\n");
console.log("| Session | Mode | Comparable | Proposed | Hits | Precision | Recall | Tree coverage | Abstention |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|---|");
let skipped = 0;
const ratio = (n, d) => d ? `${n}/${d}` : "not applicable";
for (const target of targets) {
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-tree", "-rz", "--name-only", target.startCommit], { cwd, encoding: "utf8" })
      .split("\0").filter(Boolean);
  } catch { skipped++; continue; }
  for (const mode of ["unseeded", ...(target.scope.length ? ["seeded"] : [])]) {
    let proposal;
    try {
      proposal = proposeScope({ intent: target.intent, seeds: mode === "seeded" ? target.scope : [] }, all, tracked, repo, target.startedAt);
    } catch (error) {
      proposal = { scope: [], comparable: "not evaluated", reason: error.message };
    }
    const reality = new Set(target.reality);
    const hits = proposal.scope.filter((p) => reality.has(p)).length;
    const reason = (proposal.reason ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
    console.log(`| ${target.id.slice(0, 8)} | ${mode} | ${proposal.comparable} | ${proposal.scope.length} | ${hits} | ${ratio(hits, proposal.scope.length)} | ${ratio(hits, reality.size)} | ${ratio(proposal.scope.length, tracked.length)} | ${reason} |`);
  }
}
console.log(`\n${targets.length} eligible targets; ${skipped} skipped because their historical tree could not be read.`);
console.log("This evaluates one repository. It does not establish performance on other repositories.");
