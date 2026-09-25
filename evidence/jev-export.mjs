// Run inside the matching repository: node evidence/jev-export.mjs session.jsonl > sessions.json
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const increment = (counts, reason) => counts.set(reason, (counts.get(reason) ?? 0) + 1);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function readRecords(file) {
  return readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${index + 1}. Repair the log copy.`); }
    if (!isObject(record) || typeof record.id !== "string" || !isObject(record.set)
      || (record.v !== undefined && record.v !== 1)) throw new Error(`Invalid record on line ${index + 1}. Check the log format.`);
    return [record];
  });
}

function foldSessions(records) {
  const sessions = new Map();
  let orphanPatches = 0;
  for (const { id, set } of records) {
    const existing = sessions.get(id);
    if (!existing) {
      if (typeof set.startedAt !== "string" || !("intent" in set) || !("startCommit" in set)) { orphanPatches++; continue; }
      sessions.set(id, { intent: set.intent, intentSource: set.intentSource, startCommit: set.startCommit,
        reality: set.reality, endedAt: set.endedAt });
    } else {
      if ("reality" in set) existing.reality = set.reality;
      if ("endedAt" in set) existing.endedAt = set.endedAt;
    }
  }
  return { sessions: [...sessions.values()], orphanPatches };
}

function skipReason(session) {
  const source = session.intentSource === undefined ? "declared" : session.intentSource;
  if (source !== "declared") return source === "captured" || source === "primed" ? source : "unknown intent source";
  if (typeof session.intent !== "string" || !session.intent.trim()) return "missing intent";
  if (typeof session.endedAt !== "string" || !Number.isFinite(Date.parse(session.endedAt))) return "unfinished session";
  if (!Array.isArray(session.reality) || session.reality.some((path) => typeof path !== "string" || !path)) return "invalid reality";
  if (!session.reality.length) return "no changed files";
  if (typeof session.startCommit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(session.startCommit)) return "missing start commit";
  return null;
}

function trackedAtCommit(commit) {
  const directory = mkdtempSync(join(tmpdir(), "jev-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, "index"), GIT_NO_LAZY_FETCH: "1" };
  const options = { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 32 * 1024 * 1024 };
  try {
    options.cwd = execFileSync("git", ["rev-parse", "--show-toplevel"], options).trim();
    execFileSync("git", ["read-tree", commit], options);
    return execFileSync("git", ["ls-files", "--cached", "--full-name", "-z"], options).split("\0").filter(Boolean);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function exportSessions(sessions) {
  const exported = [], skipped = new Map(), trees = new Map();
  for (const session of sessions) {
    const reason = skipReason(session);
    if (reason) { increment(skipped, reason); continue; }
    if (!trees.has(session.startCommit)) {
      try { trees.set(session.startCommit, trackedAtCommit(session.startCommit)); }
      catch { trees.set(session.startCommit, null); }
    }
    const candidatePaths = trees.get(session.startCommit);
    if (candidatePaths === null) { increment(skipped, "unavailable start tree"); continue; }
    exported.push({ intent: session.intent, candidatePaths, changedPaths: session.reality });
  }
  return { exported, skipped };
}

function main() {
  if (process.argv.length !== 3) throw new Error("Usage: node evidence/jev-export.mjs <session.jsonl> (inside its repository).");
  const { sessions, orphanPatches } = foldSessions(readRecords(process.argv[2]));
  const { exported, skipped } = exportSessions(sessions);
  console.error(`Exported: ${exported.length}; skipped: ${[...skipped.values()].reduce((sum, count) => sum + count, 0)}`);
  for (const [reason, count] of skipped) console.error(`  ${reason}: ${count}`);
  if (orphanPatches) console.error(`Ignored records without a creating record: ${orphanPatches}`);
  console.log(JSON.stringify(exported, null, 2));
}

try { main(); } catch (error) {
  console.error(error.code ? "Export failed. Check the log path and repository access." : error.message);
  process.exitCode = 1;
}
