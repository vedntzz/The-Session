import type { SettlementDecision } from "../../commands/settle.js";
import { manualOutcome, observations } from "../../outcome.js";
import type { Session } from "../../store.js";
import { plainPalette, plainUiTheme, type Palette, type UiTheme } from "../palette.js";
import { intentOf } from "../terminal/intent.js";
import { plural } from "../terminal/text.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import { parseQuery, selectedFilters, visibleSessions, SCROLL_STEP, type UiState } from "./state.js";
import { fit, fold } from "./text.js";

export interface OutcomesUiData {
  sessions: Session[];
  decisions: Map<string, SettlementDecision>;
  repo: string; branch?: string; tip?: string; days?: undefined;
}

function status(decision: SettlementDecision, branch?: string): string {
  if (!("skipped" in decision)) return decision.wouldRecord
    ? `Ready to record: ${decision.outcome} (computed observation)` : "Already recorded; nothing to append";
  if (decision.skipped === "empty") return "Changed no files; no outcome observation is needed";
  if (decision.skipped === "stillOpen") return "Still running or in flight; no terminal outcome to record";
  return branch ? "Unknown: end states were not recorded" : "Unknown: no default branch could be checked";
}

/** Live reported outcomes and a distinct, native decision about what could be recorded. */
export function renderOutcomesUi(data: OutcomesUiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return { lines: fold("Resize to at least 60 columns and 20 rows, or q to return Home.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0 };
  const sessions = visibleSessions(data.sessions, state); const selected = sessions[state.selected];
  const add = (lines: UiLine[], text: string, role: UiLine["role"] = "text", chosen = false): void => {
    lines.push(...fold(text, width).map(text => ({ text, role, selected: chosen })));
  };
  const pending = [...data.decisions.values()].filter(decision => !("skipped" in decision) && decision.wouldRecord).length;
  const branding = sessionHeader(data.repo, data.branch ?? "Default branch unavailable", "WORK OUTCOMES", width).filter(line => rows >= 28 || line.text);
  const header: UiLine[] = [...branding];
  add(header, `${plural(data.sessions.length, "session", "sessions")} in this repo · ${pending} ready to record`, "meta");
  const search = state.searching ? fold(state.query + "▌", width - 2).at(-1)! : state.query || "/ Search sessions or files";
  header.push({ text: `> ${fit(search, width - 2)}`, role: "focus" });
  const detailed = fold(notice, width).length > 1;
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, "r Refresh · w Record outcomes for ALL sessions in this repo", "focus");
  add(footer, "/ Search · ↑↓ Select · Enter Details · o/s/d Filters", "focus");
  add(footer, "PgUp/PgDn Scroll · ? Help · Esc Back · q Home · Ctrl-C Exit", "focus");
  add(footer, detailed ? "Status details above · PgUp/PgDn scroll" : notice || `Session ${selected ? state.selected + 1 : 0}/${sessions.length}`, "meta");
  if (header.length + footer.length > rows - 1 - SCROLL_STEP) header.splice(0, branding.length, { text: "WORK OUTCOMES", role: "meta" });
  const content: UiLine[] = []; let anchor = 0;
  if (detailed) add(content, notice, "focus");
  if (state.help) ["KEYBOARD", "r rereads all local records and Git evidence; it writes nothing",
    "w, then type record and Enter, appends signed outcome observations",
    "Recording checks fresh evidence for ALL sessions in this repo, regardless of filters",
    "Completed appends stay recorded if a later write fails or you exit",
    "Empty, running, in-flight and unknown sessions are skipped; unchanged outcomes are not appended",
    "A computed abandoned verdict displays as open; only a manual mark says abandoned",
    "Existing manual marks keep precedence; this screen does not create a manual mark",
    "/ searches IDs, goals and paths; o result, s goal source, d outside plan",
    "Typed filters: outcome:merged, source:declared, outside:yes (combine with search)",
    "↑↓ or j/k selects; Home/End selects first/last; Enter expands details",
    "PgUp/PgDn or Ctrl-U/Ctrl-D scroll; ? or Esc closes Help",
    "q Home · Ctrl-C Exit"].forEach(text => add(content, text));
  else {
    add(content, `Default branch: ${data.branch ?? "none found — looked for origin/HEAD, main, master"}`, "meta");
    if (data.tip) add(content, `Checked commit: ${data.tip}`, "meta");
    const filters = selectedFilters(state);
    if (filters.length) add(content, filters.map(([key, value]) => `${key}:${value}`).join(" · "), "meta");
    sessions.forEach((session, index) => {
      const chosen = session.id === selected?.id;
      if (chosen && !detailed) anchor = index === 0 ? 0 : content.length;
      add(content, `${chosen ? ">" : " "} ${intentOf(session)}`, "intent", chosen);
      add(content, `Current outcome: ${session.outcome}`);
      const decision = data.decisions.get(session.id)!;
      add(content, status(decision, data.branch), "meta");
      if (chosen && state.expanded && !state.searching) {
        add(content, `Session ID: ${session.id}`, "meta");
        const manual = manualOutcome(session);
        if (manual) add(content, `Manual override preserved: ${manual.outcome}`, "meta");
        if (decision.verdict) {
          add(content, manual ? "Git evidence (manual mark takes precedence):" : "Git evidence:", "meta");
          for (const [label, paths] of [["Landed", decision.verdict.landed], ["In flight", decision.verdict.inFlight], ["Not found", decision.verdict.lost]] as const) {
            for (const path of paths) add(content, `${label}: ${JSON.stringify(path)}`);
          }
          if (!session.reality.length || !Object.keys(session.endState ?? {}).length) add(content, "Nothing was left behind", "meta");
        }
        if (!observations(session).length) add(content, "No recorded outcome observation", "meta");
        for (const seen of observations(session)) add(content,
          `Observed ${seen.observedAt} · ${seen.outcome} · ${seen.source} · branch ${seen.branch} · commit ${seen.commit}`, "meta");
      }
      content.push({ text: "" });
    });
    if (!sessions.length) add(content, parseQuery(state.query).error ?? (data.sessions.length
      ? "No matching sessions. Esc clears search and filters." : "No sessions recorded for this repository. Start a session from Home."));
  }
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height); while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
