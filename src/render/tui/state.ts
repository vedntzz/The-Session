import { hasDeclaredScope, INTENT_SOURCES, intentSourceOf, type Session, type SessionOutcome } from "../../store.js";

export const OUTCOMES: readonly (SessionOutcome | "all")[] = ["all", "open", "merged", "abandoned", "empty"];
interface HistoryFilter { key: "outcome" | "source" | "outside"; shortcut: string; label: string; values: readonly string[] }
export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  { key: "outcome", shortcut: "o", label: "Result", values: OUTCOMES },
  { key: "source", shortcut: "s", label: "Goal source", values: ["all", ...INTENT_SOURCES] },
  { key: "outside", shortcut: "d", label: "Outside plan", values: ["all", "yes", "no"] },
];
export interface UiState {
  selected: number;
  scroll: number;
  query: string;
  searching: boolean;
  outcome: number;
  source: number;
  outside: number;
  expanded: boolean;
  evidence: boolean;
  usage: boolean;
  help: boolean;
}
export function initialState(): UiState {
  return { selected: 0, scroll: 0, query: "", searching: false, outcome: 0, source: 0, outside: 0,
    expanded: true, evidence: false, usage: false, help: false };
}

/** Search, filters and help handle Escape before the browser returns Home. */
export function canReturnHome(state: UiState): boolean {
  return !state.searching && !state.help && !state.query && HISTORY_FILTERS.every(filter => state[filter.key] === 0);
}

export function selectedFilters(state: UiState): [string, string][] {
  return HISTORY_FILTERS.filter(filter => state[filter.key] !== 0)
    .map<[string, string]>(filter => [filter.key, filter.values[state[filter.key]] ?? "invalid"]);
}

/** Exact, deterministic filters. Unknown filter values never silently broaden a query. */
export function parseQuery(query: string): { terms: string[]; filters: [string, string][]; error?: string } {
  const terms: string[] = [];
  const filters: [string, string][] = [];
  for (const token of query.trim().toLowerCase().split(/\s+/u).filter(Boolean)) {
    const match = /^(outside|outcome|source):(.*)$/u.exec(token);
    if (!match) { terms.push(token); continue; }
    const key = match[1]!;
    const value = match[2]!;
    const valid = HISTORY_FILTERS.find(filter => filter.key === key)!.values.slice(1);
    if (!valid.includes(value)) return { terms, filters, error: `${key}: use ${valid.join(" / ")}` };
    filters.push([key, value]);
  }
  return { terms, filters };
}

/** Typed filters and keyboard choices measure the same facts. */
function matchesFilter(session: Session, [key, value]: [string, string]): boolean {
  if (key === "source") return intentSourceOf(session) === value;
  if (key === "outcome") return session.outcome === value;
  // Neither passive capture nor a running session can claim zero drift.
  return key === "outside" && (value === "yes" || value === "no") && hasDeclaredScope(session) && session.endedAt !== null &&
    (value === "yes" ? session.drift.length > 0 : session.drift.length === 0);
}
export function visibleSessions(sessions: readonly Session[], state: UiState): Session[] {
  const query = parseQuery(state.query);
  if (query.error) return [];
  const filters = [...query.filters, ...selectedFilters(state)];
  return sessions.filter((session) => {
    const text = [session.id, session.intent ?? "", ...session.reality, ...session.scope].join(" ").toLowerCase();
    return query.terms.every(term => text.includes(term)) && filters.every(filter => matchesFilter(session, filter));
  });
}
export interface UiKey { name?: string; ctrl?: boolean; sequence?: string }
/**
 * Scrolling steps from the offset the screen shows, not the one last stored.
 * A resize changes `maxScroll` without a key press, and the renderer clamps a
 * stale offset silently; stepping from the stale one would spend PgUp presses
 * moving an offset nobody can see.
 */
function scrolled(state: UiState, maxScroll: number, delta: number): number {
  return Math.max(0, Math.min(maxScroll, Math.min(state.scroll, maxScroll) + delta));
}
export function navigate(state: UiState, key: UiKey, count: number, maxScroll: number): UiState {
  const next = { ...state };
  if (state.searching) {
    if (key.name === "escape") return initialState();
    if (key.name === "return") next.searching = false;
    else if (key.name === "backspace") next.query = [...next.query].slice(0, -1).join("");
    else if (key.ctrl && key.name === "u") next.query = "";
    else if (!key.ctrl && key.sequence && !/[\u0000-\u001f\u007f-\u009f]/u.test(key.sequence)) next.query += key.sequence;
    return { ...next, selected: 0, scroll: 0 };
  }
  const name = key.name ?? key.sequence;
  if (key.sequence === "?" || name === "?") return { ...next, help: !next.help, scroll: 0 };
  if (state.help) {
    if (name === "escape") return { ...next, help: false, scroll: 0 };
    const delta = name === "pageup" || name === "up" ? -5 : name === "pagedown" || name === "down" ? 5 : 0;
    return { ...next, scroll: scrolled(state, maxScroll, delta) };
  }
  const filter = !key.ctrl && HISTORY_FILTERS.find(choice => choice.shortcut === name);
  if (key.sequence === "/") next.searching = true;
  else if (name === "return") { next.expanded = !next.expanded; next.scroll = 0; }
  else if (name === "e") { next.evidence = !next.evidence; next.expanded = true; next.scroll = 0; }
  else if (name === "escape") return initialState();
  else if (filter) return { ...next, [filter.key]: (state[filter.key] + 1) % filter.values.length,
    selected: 0, scroll: 0, evidence: false };
  else if (name === "pageup" || name === "pagedown" || (key.ctrl && (name === "u" || name === "d"))) {
    next.scroll = scrolled(state, maxScroll, name === "pageup" || name === "u" ? -5 : 5);
  } else {
    const delta = name === "up" || name === "k" ? -1 : name === "down" || name === "j" ? 1 : 0;
    next.selected = Math.max(0, Math.min(count - 1, name === "home" ? 0 : name === "end" ? count - 1 : state.selected + delta));
    if (next.selected !== state.selected) { next.scroll = 0; next.evidence = false; }
  }
  return next;
}
