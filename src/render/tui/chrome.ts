import type { UiRole, UiTheme } from "../palette.js";
import { fit } from "./text.js";

/** Text rendition of the supplied open-ring mark; no terminal image protocol needed. */
export const SESSION_MARK = ["⠀⠀⢀⣠⣄⠀⠀⠀", "⠀⣰⠋⠀⠀⠀⣆⠀", "⠀⠹⣄⠀⠀⣠⠏⠀", "⠀⠀⠈⠙⠋⠁⠀⠀"] as const;
export interface UiLine { text: string; role?: UiRole; selected?: boolean }

export function sessionHeader(repo: string, branch: string, section: string, width: number): UiLine[] {
  const captions = ["SESSION", repo, branch, section];
  return [
    ...SESSION_MARK.map((mark, i) => ({
      text: mark + "   " + fit(captions[i]!, width - 11),
      role: i === 0 ? "intent" as const : "meta" as const,
    })),
    { text: "" }, { text: "─".repeat(width), role: "meta" }, { text: "" },
  ];
}

export function paintUiLine(line: UiLine, layout: { width: number; left: number; terminalWidth: number }, theme: UiTheme): string {
  const { width, left, terminalWidth } = layout;
  return theme.paint(" ".repeat(left)) + theme.paint(fit(line.text, width), line.role, line.selected) +
    theme.paint(" ".repeat(terminalWidth - left - width));
}
