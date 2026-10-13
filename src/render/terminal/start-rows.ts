import type { Palette } from "../palette.js";
import { fold, safeText } from "../tui/text.js";
import { INDENT, label, MIN_WIDTH } from "./text.js";

/** Measure plain values before applying the terminal's ink. */
export function startRows(
  name: string, value: string, ink: (text: string) => string,
  palette: Palette, width?: number, continuation = 0,
): string[] {
  const clean = safeText(value);
  const available = width === undefined ? undefined : Math.max(MIN_WIDTH, width) - (INDENT + label("")).length - continuation;
  const parts = available === undefined ? [clean] : fold(clean, available);
  return parts.map((part, index) =>
    `${INDENT}${palette.meta(label(index === 0 ? name : ""))}${index > 0 ? " ".repeat(continuation) : ""}${ink(part)}`);
}

/** Keep the complete declared scope in the existing labelled layout. */
export function startScopeRows(scope: readonly string[], palette: Palette, width?: number): string[] {
  return scope.length > 0
    ? scope.flatMap((path, index) => startRows(index === 0 ? "scope" : "", path, palette.path, palette, width, 2))
    : startRows("scope", "none declared", palette.meta, palette, width);
}

/** Legacy metadata keeps its own indentation and all of its text. */
export function startDetails(details: readonly string[], width?: number): string[] {
  if (width === undefined) return details.map(safeText);
  return details.flatMap(detail => {
    const indent = detail.startsWith(INDENT) ? INDENT : "";
    const clean = safeText(detail).slice(indent.length);
    return fold(clean, Math.max(MIN_WIDTH, width) - indent.length).map(line => indent + line);
  });
}
