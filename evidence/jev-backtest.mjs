// Usage: npm run build && node evidence/jev-backtest.mjs sessions.json [--dry]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function scoreSessions(sessions, suggestions) {
  if (sessions.length !== suggestions.length) throw new Error("Each session needs one suggestion list.");
  const rows = sessions.map(({ changedPaths }, index) => {
    const changed = new Set(changedPaths);
    if (!changed.size) throw new Error("Scoring requires changed paths.");
    const paths = [...new Set(suggestions[index].map(({ path }) => path))];
    const hits = (k) => paths.slice(0, k).filter((path) => changed.has(path)).length;
    const hits3 = hits(3), hits10 = hits(10);
    return { session: index + 1, changed: changed.size, hits3, hits10,
      recall3: hits3 / changed.size, recall10: hits10 / changed.size };
  });
  return { rows, median3: median(rows.map((row) => row.recall3)), median10: median(rows.map((row) => row.recall10)),
    hit3: rows.filter((row) => row.hits3 > 0).length, hit10: rows.filter((row) => row.hits10 > 0).length };
}

function skipReason(session) {
  if (!session || typeof session.intent !== "string" || !session.intent.trim()) return "invalid intent";
  for (const field of ["candidatePaths", "changedPaths"]) {
    if (!Array.isArray(session[field]) || session[field].some((path) => typeof path !== "string" || !path)) return `invalid ${field}`;
  }
  if (!session.changedPaths.length) return "no changed files";
  return null;
}

async function collectPredictions(sessions, suggest) {
  const eligible = [], predictions = [], numbers = [], skipped = new Map();
  for (const [index, session] of sessions.entries()) {
    const reason = skipReason(session);
    if (reason) { skipped.set(reason, (skipped.get(reason) ?? 0) + 1); continue; }
    eligible.push(session);
    numbers.push(index + 1);
    predictions.push(await suggest({ intent: session.intent, candidatePaths: session.candidatePaths }));
  }
  return { scores: scoreSessions(eligible, predictions), numbers, skipped };
}

const percent = (value) => value === null ? "not measured" : `${(100 * value).toFixed(1)}%`;

function printReport({ scores, numbers, skipped }, dry) {
  console.log(dry ? "DRY: deterministic candidate-order stub; not Jev performance." : "Jev scope backtest");
  console.log(`Sessions scored: ${scores.rows.length}; skipped: ${[...skipped.values()].reduce((a, b) => a + b, 0)}`);
  for (const [reason, count] of skipped) console.log(`  ${reason}: ${count}`);
  console.log("Session | Recall@3 (hits/changed) | Recall@10 (hits/changed)");
  scores.rows.forEach((row, index) => console.log(`${numbers[index]} | ${percent(row.recall3)} (${row.hits3}/${row.changed}) | ${percent(row.recall10)} (${row.hits10}/${row.changed})`));
  console.log(`Median recall@3: ${percent(scores.median3)}; median recall@10: ${percent(scores.median10)}`);
  console.log("Old per-session baseline (supplied): 6%, 18%, 12%; median 12% (range 6–18%); sessions not matched.");
  const rate = (hits) => scores.rows.length ? `${hits}/${scores.rows.length} (${percent(hits / scores.rows.length)})` : "not measured (0 sessions)";
  console.log(`Secondary hits-per-session: top-3 ${rate(scores.hit3)}; top-10 ${rate(scores.hit10)}`);
  console.log("Recall is calculated per session; empty suggestions score zero. Files are not pooled.");
}

async function main() {
  const args = process.argv.slice(2), dry = args.includes("--dry"), files = args.filter((arg) => arg !== "--dry");
  if (files.length !== 1) throw new Error("Usage: node evidence/jev-backtest.mjs <sessions.json> [--dry]");
  const sessions = JSON.parse(readFileSync(files[0], "utf8"));
  if (!Array.isArray(sessions)) throw new Error("Expected a JSON array. Run jev-export.mjs first.");
  if (!dry && (!process.env.JEV_API_KEY || !process.env.JEV_ENDPOINT)) throw new Error("Set JEV_API_KEY and JEV_ENDPOINT, or use --dry.");
  const suggest = dry
    ? ({ candidatePaths }) => [...new Set(candidatePaths)].slice(0, 10).map((path) => ({ path, confidence: 1, reason: "dry stub" }))
    : (await import("../dist/jev/suggest-scope.js")).suggestScope;
  printReport(await collectPredictions(sessions, suggest), dry);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Backtest failed. Check the JSON input, build output and JEV_API_KEY/JEV_ENDPOINT, or use --dry.");
    process.exitCode = 1;
  });
}
