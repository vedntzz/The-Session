import { hasDeclaredScope, intentSourceOf, type Session, type SessionOutcome } from "../../store.js";

export const OUTCOMES: readonly (SessionOutcome | "all")[] = ["all", "open", "merged", "abandoned", "empty"];
export interface UiState {
  selected: number;
  scroll: number;
  query: string;
  searching: boolean;
  outcome: number;
  expanded: boolean;
  evidence: boolean;
  help: boolean;
}
export function initialState(): UiState {
  return { selected: 0, scroll: 0, query: "", searching: false, outcome: 0, expanded: true, evidence: false, help: false };
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
    const valid = key === "outside" ? ["yes", "no"] : key === "source" ? ["declared", "primed", "captured"] : OUTCOMES.slice(1);
    if (!valid.includes(value)) return { terms, filters, error: `${key}: use ${valid.join(" / ")}` };
    filters.push([key, value]);
  }
  return { terms, filters };
}
export function visibleSessions(sessions: readonly Session[], state: UiState): Session[] {
  const query = parseQuery(state.query);
  if (query.error) return [];
  return sessions.filter((session) => {
    if (OUTCOMES[state.outcome] !== "all" && session.outcome !== OUTCOMES[state.outcome]) return false;
    const text = [session.id, session.intent ?? "", ...session.reality, ...session.scope].join(" ").toLowerCase();
    return query.terms.every((term) => text.includes(term)) && query.filters.every(([key, value]) => {
      if (key === "source") return intentSourceOf(session) === value;
      if (key === "outcome") return session.outcome === value;
      // Neither passive capture nor a running session can claim zero drift.
      return hasDeclaredScope(session) && session.endedAt !== null &&
        (value === "yes" ? session.drift.length > 0 : session.drift.length === 0);
    });
  });
}
export interface UiKey { name?: string; ctrl?: boolean; sequence?: string }
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
    return { ...next, scroll: Math.max(0, Math.min(maxScroll, state.scroll + delta)) };
  }
  if (key.sequence === "/") next.searching = true;
  else if (name === "return") { next.expanded = !next.expanded; next.scroll = 0; }
  else if (name === "e") { next.evidence = !next.evidence; next.expanded = true; next.scroll = 0; }
  else if (name === "escape") return initialState();
  else if (name === "o") { next.outcome = (state.outcome + 1) % OUTCOMES.length; next.selected = 0; next.scroll = 0; }
  else if (name === "pageup" || name === "pagedown" || (key.ctrl && (name === "u" || name === "d"))) {
    next.scroll = Math.max(0, Math.min(maxScroll, state.scroll + (name === "pageup" || name === "u" ? -5 : 5)));
  } else {
    const delta = name === "up" || name === "k" ? -1 : name === "down" || name === "j" ? 1 : 0;
    next.selected = Math.max(0, Math.min(count - 1, name === "home" ? 0 : name === "end" ? count - 1 : state.selected + delta));
    if (next.selected !== state.selected) { next.scroll = 0; next.evidence = false; }
  }
  return next;
}
