// Backtest of the designed `prime` rule against this repo's real log.
// Every ranking function is the shipped one, imported from dist/.
import { readSessions } from "/Users/vedant/dev-session/dist/store.js";
import { partnersOf } from "/Users/vedant/dev-session/dist/cochange.js";
import { debtOf, IGNORED_CLASSES, MIN_HISTORY } from "/Users/vedant/dev-session/dist/debt.js";
import { classifyIntent, classOfPath } from "/Users/vedant/dev-session/dist/classify.js";
import { inScope } from "/Users/vedant/dev-session/dist/scope.js";

const CAP = 5;
const SEEDS = 3;

/** Sessions of this repo that had closed before `target` opened. */
const historyFor = (all, target) =>
  all.filter((s) => s.endedAt !== null && s.endedAt < target.startedAt);

const worthProposing = (path) => !IGNORED_CLASSES.includes(classOfPath(path));

/** How often each path appears in `reality`, counted once per session. */
function frequency(sessions) {
  const counts = new Map();
  for (const s of sessions) {
    for (const p of new Set(s.reality)) {
      if (worthProposing(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return counts;
}

/** Step 1: what the developer named, else the class's busiest paths. */
function seedsOf(request, history) {
  if (request.seeds?.length) return request.seeds;
  const cls = classifyIntent(request.intent);
  const ofClass = history.filter((s) => s.class === cls);
  return [...frequency(ofClass.length ? ofClass : history)]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SEEDS)
    .map(([path]) => path);
}

/** Step 2: co-change partners of each seed. */
function expand(seeds, history) {
  const out = new Map();
  for (const seed of seeds) {
    for (const p of partnersOf(seed, history)) {
      if (!out.has(p.path)) out.set(p.path, { ...p, why: "partner" });
    }
  }
  return out;
}

/** Step 3: paths that keep drifting and were never declared since. */
function debtPaths(history, repo) {
  const report = debtOf(history, new Map());
  const mine = report.repos.find((r) => r.repo === repo);
  return (mine?.files ?? []).map((f) => ({ path: f.path, sessions: f.sessions, why: "debt" }));
}

/** Step 4: a parent directory stands in for two or more of its own files. */
function rollUp(paths) {
  const byParent = new Map();
  for (const p of paths) {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    byParent.set(parent, [...(byParent.get(parent) ?? []), p]);
  }
  return paths.map((p) => {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    return parent !== "" && (byParent.get(parent)?.length ?? 0) >= 2 ? `${parent}/` : p;
  });
}

/** The whole rule. Pure: sessions in, a proposal out. */
export function prime(request, history, repo) {
  if (history.length < MIN_HISTORY) {
    return { repo, history: history.length };           // absent, not empty
  }
  const seeds = seedsOf(request, history);
  const candidates = expand(seeds, history);
  for (const d of debtPaths(history, repo)) {
    if (!candidates.has(d.path)) candidates.set(d.path, d);
  }
  for (const s of seeds) {
    if (!candidates.has(s)) candidates.set(s, { path: s, sessions: 0, why: "seed" });
  }
  const ranked = [...candidates.values()]
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.sessions - a.sessions ||
                    a.path.localeCompare(b.path))
    .slice(0, CAP);
  return { repo, history: history.length, seeds,
           paths: [...new Set(rollUp(ranked.map((r) => r.path)))],
           detail: ranked };
}

// ---- the run ----------------------------------------------------------
import { execFileSync } from "node:child_process";
const tracked = execFileSync("git", ["ls-files"], { cwd: "/Users/vedant/dev-session" })
  .toString().trim().split("\n").filter(worthProposing);
const all = await readSessions({ cwd: "/Users/vedant/dev-session" });
const targets = ["5a2f990d", "bc012da3", "263b1ee6"];

for (const short of targets) {
  const t = all.find((s) => s.id.startsWith(short));
  const history = historyFor(all, t);
  const p = prime({ intent: t.intent, seeds: t.scope }, history, t.repo);

  console.log("=".repeat(74));
  console.log(`${short}  ${t.startedAt.slice(0, 10)}  ${JSON.stringify(t.intent).slice(0, 62)}`);
  console.log(`history before it: ${history.length} sessions | actually declared: ` +
              (t.scope.length ? t.scope.join(" ") : "(nothing)"));
  if (!p.paths) { console.log("  no proposal — under MIN_HISTORY"); continue; }
  console.log(`seeds: ${p.seeds.join("  ")}`);
  console.log("proposed:");
  for (const d of p.detail) {
    console.log(`  ${d.why.padEnd(8)} ${d.path.padEnd(42)}` +
                (d.rate !== undefined ? ` rate ${d.rate.toFixed(2)} over ${d.sessions}` : ` ${d.sessions} drifting sessions`));
  }
  console.log(`rolled up to: ${p.paths.join("  ")}`);

  const real = t.reality.filter(worthProposing);
  const exact = p.detail.map((d) => d.path);
  const pct = (n, d) => `${n}/${d} (${Math.round((100 * n) / (d || 1))}%)`;
  const cover = (entries) => real.filter((r) => inScope(entries, r)).length;
  const breadth = (entries) => tracked.filter((f) => inScope(entries, f)).length;

  console.log(`reality: ${t.reality.length} paths (${real.length} proposable)`);
  console.log(`  exact paths   covered ${pct(cover(exact), real.length)}` +
              `   claims ${breadth(exact)}/${tracked.length} of the tree`);
  console.log(`  rolled up     covered ${pct(cover(p.paths), real.length)}` +
              `   claims ${breadth(p.paths)}/${tracked.length} of the tree`);
  const missed = real.filter((r) => !inScope(exact, r));
  console.log(`  exact would still have drifted: ${missed.length}` +
              (missed.length ? ` — e.g. ${missed.slice(0, 3).join(", ")}` : ""));
}
