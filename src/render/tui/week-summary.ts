import { emptyTurnsTotal } from "../../empty.js";
import { wasMeasured, type Spend } from "../../pricing.js";
import { hasDeclaredScope, type Session, type TokenCounts } from "../../store.js";
import { figure, plural } from "../terminal/text.js";
import type { UiLine } from "./chrome.js";

const TOKEN_LABELS: Readonly<Record<keyof TokenCounts, string>> = {
  inputTokens: "Input tokens", cacheReadTokens: "Cache read tokens",
  cacheCreationTokens: "Cache creation tokens", outputTokens: "Output tokens",
};
const missingTokens = (sessions: readonly Session[]): number =>
  sessions.reduce((total, session) => total + (session.cost.untokenedTurns ?? 0), 0);

/** One source only. A repeated path is a change in each session, never a unique-file count. */
export function weekSummary(sessions: readonly Session[], usage: boolean): UiLine[] {
  if (!sessions.length) return [];
  const finished = sessions.filter(session => session.endedAt !== null);
  const scoped = finished.filter(hasDeclaredScope);
  const changed = finished.reduce((total, session) => total + session.reality.length, 0);
  const outside = scoped.reduce((total, session) => total + session.drift.length, 0);
  const running = sessions.length - finished.length;
  const lines: UiLine[] = [
    { text: finished.length ? `File changes: ${figure(changed)} across ${plural(finished.length, "finished session", "finished sessions")} (counted per session).`
      : "File changes: not measured; all sessions are running.", role: "meta" },
    { text: scoped.length ? `Outside plan: ${plural(outside, "file change", "file changes")} across ${plural(scoped.length, "finished declaration", "finished declarations")}.`
      : "Outside plan: not measured; no finished declaration.", role: outside ? "drift" : "meta" },
  ];
  if (running) lines.push({ text: `${plural(running, "running session", "running sessions")}: file changes and drift not measured yet.`, role: "meta" });
  if (!usage) return lines;
  const captured = sessions.filter(session => wasMeasured(session.cost));
  const allCaptured = captured.length === sessions.length;
  const tokenCountsKnown = allCaptured && missingTokens(sessions) === 0;
  const turns = captured.reduce((total, session) => total + session.cost.turns, 0);
  const empty = allCaptured && !running ? emptyTurnsTotal(sessions) : undefined;
  lines.push({ text: "USAGE TOTALS", role: "focus" },
    { text: `Usage captured: ${captured.length}/${sessions.length} sessions.`, role: "meta" },
    { text: `Turns: ${allCaptured ? figure(turns) : "not fully captured"}`, role: "meta" });
  for (const key of Object.keys(TOKEN_LABELS) as (keyof TokenCounts)[]) {
    const total = tokenCountsKnown ? figure(sessions.reduce((sum, session) => sum + session.cost[key], 0)) : "not fully captured";
    lines.push({ text: `${TOKEN_LABELS[key]}: ${total}`, role: "meta" });
  }
  lines.push({ text: `Turns that changed no files: ${empty === undefined ? "not measured" : figure(empty)}`, role: "meta" });
  return lines;
}

/** Missing prices and missing capture need different explanations, never a guessed total. */
export function weekCoverage(spend: Spend, sessions: readonly Session[]): UiLine[] {
  const lines: UiLine[] = [];
  if (spend.unpriced) lines.push({ text: `${plural(spend.unpriced, "session", "sessions")} unpriced: ${spend.unpricedModels.join(", ")}`, role: "meta" });
  if (spend.uncaptured) lines.push({ text: `${plural(spend.uncaptured, "session", "sessions")} uncaptured: no turns on the record, so nothing to price.`, role: "meta" });
  const missing = missingTokens(sessions);
  if (missing) lines.push({ text: `${plural(missing, "turn", "turns")} ${missing === 1 ? "has" : "have"} no recorded token counts.`, role: "meta" });
  return lines;
}
