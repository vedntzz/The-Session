import type { RepoDebt } from "../../debt.js";
import type { PrimeProposal, PrimeRequest } from "../../prime.js";
import { plainPalette, plainUiTheme, type Palette, type UiTheme } from "../palette.js";
import { formatPrimeDetails } from "../prime.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import { navigate, SCROLL_STEP, type UiState } from "./state.js";
import { fold } from "./text.js";

export interface PrimeUiData {
  repo: string;
  request: PrimeRequest;
  preview?: { proposal: PrimeProposal; debt: RepoDebt };
}

/** A proposal is one document, not selectable signed session rows. */
export const navigatePrime: typeof navigate = (state, key, _count, maxScroll) => {
  const name = key.name ?? key.sequence;
  if (!key.ctrl && (name === "home" || name === "end")) return { ...state, scroll: name === "home" ? 0 : maxScroll };
  const mapped = name === "up" || name === "k" ? "pageup" : name === "down" || name === "j" ? "pagedown" : name;
  if (["?", "escape", "pageup", "pagedown"].includes(mapped ?? "") || (key.ctrl && (name === "u" || name === "d"))) {
    return navigate(state, { ...key, name: mapped }, 0, maxScroll);
  }
  return state;
};

/** Native proposal evidence and separate debt, wrapped before applying colour. */
export function renderPrimeUi(data: PrimeUiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return { lines: fold("Resize to at least 60 columns and 20 rows, or q to return Home.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0 };
  const add = (lines: UiLine[], text: string, role: UiLine["role"] = "text"): void => {
    lines.push(...fold(text, width).map(text => ({ text, role })));
  };
  const branding = sessionHeader(data.repo, "Before work starts", "PLAN WITH PRIME", width).filter(line => rows >= 28 || line.text);
  const header: UiLine[] = [...branding];
  add(header, "g Goal · s Named paths · p Preview", "focus");
  const detailed = fold(notice, width).length > 1;
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, "No session started.", "meta");
  add(footer, "Repeat session prime with --start; --scope replaces.", "meta");
  add(footer, "↑↓/PgUp/PgDn Scroll · r Refresh · ? Help · q Home", "focus");
  add(footer, detailed ? "Status details above · PgUp/PgDn scroll" : notice || "g sets a goal; p reviews suggested files", "meta");
  if (header.length + footer.length > rows - 1 - SCROLL_STEP) header.splice(0, branding.length, { text: "PLAN WITH PRIME", role: "meta" });
  const content: UiLine[] = [];
  if (detailed) add(content, notice, "focus");
  if (state.help) ["KEYBOARD", "g edits the goal; s names optional repo-relative paths",
    'Paths use a JSON list, for example ["src/orders.ts"]; [] clears them',
    "Enter applies an input; Esc cancels it; Ctrl-U clears it",
    "p previews; r recomputes from the current tracked files and local history",
    "Named paths are supplied by you; historical suggestions show supporting session IDs",
    "Debt is a separate count of repeated scope misses, not part of the proposed scope",
    "Editing the goal or paths clears the preview; returning Home keeps your draft",
    "↑↓ or j/k, PgUp/PgDn, Ctrl-U/Ctrl-D scroll; Home/End jump",
    "? or Esc closes Help; q returns Home; Ctrl-C exits the workspace",
    "A preview starts no session. Repeat session prime with --start to accept; --scope replaces its scope"
  ].forEach(text => add(content, text));
  else {
    if (data.preview) formatPrimeDetails(data.preview.proposal, data.preview.debt).forEach(text => add(content, text));
    else {
      add(content, `Goal: ${JSON.stringify(data.request.intent)}`, "intent");
      add(content, data.request.intent.trim() ? "p previews files suggested by local history." : "g sets the goal before reviewing suggested files.");
    }
    add(content, `Named paths: ${JSON.stringify(data.request.seeds ?? [])}`, "meta");
  }
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - height);
  const body = content.slice(Math.min(state.scroll, maxScroll), Math.min(state.scroll, maxScroll) + height);
  while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
