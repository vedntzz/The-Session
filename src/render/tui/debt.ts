import type { RepoDebt } from "../../debt.js";
import { repoName } from "../../store.js";
import { plainPalette, plainUiTheme, type Palette, type UiTheme } from "../palette.js";
import { debtCost, debtFinding, formatDebtNotes, HERE, NOTHING_RECORDED } from "../terminal/debt.js";
import { plural } from "../terminal/text.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import { navigate, SCROLL_STEP, type UiState } from "./state.js";
import { fit, fold } from "./text.js";

export interface DebtUiData { repos: RepoDebt[]; here: string; repo: string }

/** The current repo first, then native name order. A path match keeps the complete repo. */
export function visibleDebtRepos(data: DebtUiData, state: UiState): (RepoDebt & { id: string })[] {
  const terms = state.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const ordered = [...data.repos.filter(repo => repo.repo === data.here), ...data.repos.filter(repo => repo.repo !== data.here)];
  return ordered.filter(repo => terms.every(term => [repoName(repo.repo), ...(repo.files ?? []).map(file => file.path)]
    .join(" ").toLowerCase().includes(term))).map(repo => ({ ...repo, id: repo.repo }));
}

/** History filters and evidence shortcuts have no meaning for repository rows. */
export const navigateDebt: typeof navigate = (state, key, count, maxScroll) => {
  const name = key.name ?? key.sequence;
  if (!state.searching && !state.help && (name === "e" || (!key.ctrl && ["o", "s", "d"].includes(name ?? "")))) return state;
  return navigate(state, key, count, maxScroll);
};

/** Native findings and whole-session costs, with full file paths reachable by paging. */
export function renderDebtUi(data: DebtUiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return { lines: fold("Resize to at least 60 columns and 20 rows, or q to return Home.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0 };
  const repos = visibleDebtRepos(data, state); const selected = repos[state.selected];
  const add = (lines: UiLine[], text: string, role: UiLine["role"] = "text", chosen = false): void => {
    lines.push(...fold(text, width).map(text => ({ text, role, selected: chosen })));
  };
  const branding = sessionHeader(data.repo, "All local records", "RECURRING MISSES", width).filter(line => rows >= 28 || line.text);
  const header: UiLine[] = [...branding];
  add(header, "All recorded history · repositories kept separate", "meta");
  const search = state.searching ? fold(state.query + "▌", width - 2).at(-1)! : state.query || "/ Search repositories or files";
  header.push({ text: `> ${fit(search, width - 2)}`, role: "focus" });
  const detailed = fold(notice, width).length > 1;
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, "/ Search · ↑↓ Select · Enter Details · PgUp/PgDn Scroll", "focus");
  add(footer, "r Refresh · ? Help · Esc Clear/Back · q Home · Ctrl-C Exit", "focus");
  add(footer, detailed ? "Status details above · PgUp/PgDn scroll" : notice || `Repository ${selected ? state.selected + 1 : 0}/${repos.length}`, "meta");
  if (header.length + footer.length > rows - 1 - SCROLL_STEP) header.splice(0, branding.length, { text: "RECURRING MISSES", role: "meta" });
  const content: UiLine[] = []; let anchor = 0;
  if (detailed) add(content, notice, "focus");
  if (state.help) ["KEYBOARD", "/ searches repository names and recurring file paths",
    "A file match keeps the repository's full finding and file list",
    "↑↓ or j/k selects; Home/End selects first/last; Enter expands or collapses",
    "PgUp/PgDn or Ctrl-U/Ctrl-D scroll; r rereads all local history",
    "The current repo appears first; other repos keep their name order",
    "Not enough history differs from finding no recurring misses",
    "A later accepted scope clears a file; merely suggesting it does not",
    "Cost is for whole sessions behind each file; rows cannot be added",
    "Browsing writes nothing. ? or Esc closes Help; Esc clears search before Home",
    "q Home · Ctrl-C Exit"].forEach(text => add(content, text));
  else {
    repos.forEach((repo, index) => {
      const chosen = repo.id === selected?.id;
      if (chosen && !detailed) anchor = index === 0 ? 0 : content.length;
      add(content, `${chosen ? ">" : " "} ${repoName(repo.repo)}${repo.repo === data.here ? ` ${HERE}` : ""}`, "intent", chosen);
      add(content, debtFinding(repo));
      if (chosen && state.expanded && !state.searching) {
        for (const file of repo.files ?? []) {
          add(content, JSON.stringify(file.path), "drift");
          add(content, `${plural(file.sessions, "session drifted", "sessions drifted")} · Last touched: ${file.lastTouched}`, "meta");
          add(content, `Cost of these whole sessions: ${debtCost(file)}`, "meta");
          if (file.spend.unpriced) add(content, `${plural(file.spend.unpriced, "session", "sessions")} unpriced: ${JSON.stringify(file.spend.unpricedModels)}`, "meta");
          if (file.spend.uncaptured) add(content, `${plural(file.spend.uncaptured, "session", "sessions")} without captured usage`, "meta");
        }
        formatDebtNotes({ repos: [repo] }, plainPalette).forEach(text => add(content, text, "meta"));
      }
      content.push({ text: "" });
    });
    if (!repos.length) add(content, data.repos.length ? "No matches. Esc clears search." : NOTHING_RECORDED);
  }
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height); while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
