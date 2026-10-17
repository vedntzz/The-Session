import { plainPalette, type Palette } from "../palette.js";
import { startFrameWidth } from "./start-frame.js";
import { INDENT } from "./text.js";

/** Identify the declaration flow without claiming a session is recording yet. */
export function formatStartPromptHeader(palette: Palette = plainPalette, width?: number): string[] {
  const columns = startFrameWidth(width) ?? 80;
  return [
    INDENT + palette.intent("◔ session") + palette.meta("  start a session"),
    INDENT + palette.meta("─".repeat(columns - INDENT.length)),
    "",
  ];
}
