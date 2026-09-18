import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildKnowledge, knowledgeJson, type KnowledgeGraph } from "../knowledge.js";
import { withOutcomes } from "../observe.js";
import { covers } from "../scope.js";
import { keyOf, readSessions, repoIdentity, type StoreOptions } from "../store.js";
import { renderKnowledge } from "../render/knowledge/page.js";
import { findSession } from "./show.js";

export interface KnowledgeOptions extends StoreOptions {
  days: number;
  limit: number;
  path?: string;
  session?: string;
  now?: () => Date;
  tmp?: string;
}
export function parseKnowledgeLimit(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("--limit takes a whole number from 1 to 1000.");
  return count;
}
export async function readKnowledge(options: KnowledgeOptions): Promise<KnowledgeGraph> {
  const at = options.now?.() ?? new Date();
  const cutoff = at.getTime() - options.days * 86_400_000;
  const [history, repo] = await Promise.all([readSessions(options), repoIdentity(options.cwd ?? process.cwd())]);
  let matching = history.filter((s) => Date.parse(s.startedAt) >= cutoff && Date.parse(s.startedAt) <= at.getTime());
  if (options.session) matching = [findSession(matching, options.session)];
  if (options.path !== undefined) {
    const wanted = options.path;
    if (!wanted.trim()) throw new Error("--path needs a repository-relative path or directory prefix.");
    matching = matching.filter((s) => s.reality.some((p) => covers(wanted, p)) ||
      s.scope.some((p) => covers(wanted, p) || covers(p, wanted)));
  }
  matching.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
  const sessions = await withOutcomes(matching.slice(0, options.limit), options.cwd ?? process.cwd());
  return buildKnowledge(sessions, repo, {
    at: at.toISOString(), days: options.days, matching: matching.length,
    path: options.path, session: options.session,
  });
}
export async function writeKnowledge(graph: KnowledgeGraph, options: { out?: string; tmp?: string } = {}): Promise<{ html: string; json: string }> {
  const html = options.out ? path.resolve(options.out) : path.join(
    await mkdtemp(path.join(options.tmp ?? tmpdir(), `session-knowledge-${keyOf(graph.repo)}-`)), "graph.html",
  );
  if (!/\.html?$/i.test(html)) throw new Error("--out needs an .html filename. The compact JSON is written beside it.");
  const json = html.replace(/\.html?$/i, ".json");
  await mkdir(path.dirname(html), { recursive: true });
  await writeFile(json, knowledgeJson(graph) + "\n", { encoding: "utf8", mode: 0o600 });
  await writeFile(html, renderKnowledge(graph), { encoding: "utf8", mode: 0o600 });
  return { html, json };
}
