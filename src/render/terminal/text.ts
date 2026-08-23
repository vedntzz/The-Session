// Padding, widths and the small conversions every terminal view shares.
export const INDENT = "  ";

/** Width of the label column, sized to the longest label the layout uses. */
export const LABEL_WIDTH = 12;

/** Column the right-hand gutter starts in. */
export const GUTTER = 56;

/** What the gutter narrows to rather than closing up on an over-long line. */
export const MIN_GAP = 2;

/** Visible width. Code points, not UTF-16 units, so an emoji-free intent lines up. */
export function width(text: string): number {
  return [...text].length;
}

export function label(name: string): string {
  return name.padEnd(LABEL_WIDTH);
}

/** Spaces enough to start the gutter at `GUTTER`, given the visible left side. */
export function gap(left: string): string {
  return " ".repeat(Math.max(GUTTER - width(left), MIN_GAP));
}

/** Local wall-clock time, which is how the developer remembers the session. */
export function clock(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A figure with thousands separators, so six digits can be read at a glance. */
export function figure(value: number): string {
  return value.toLocaleString("en-US");
}

export function padRight(text: string, to: number): string {
  return text + " ".repeat(Math.max(to - width(text), 0));
}

export function padLeft(text: string, to: number): string {
  return " ".repeat(Math.max(to - width(text), 0)) + text;
}
