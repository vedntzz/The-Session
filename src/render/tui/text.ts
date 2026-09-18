import { stripVTControlCharacters } from "node:util";

/** Record text is data, never a terminal command. */
export function safeText(text: string): string {
  return stripVTControlCharacters(text.replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/gu, ""))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s/gu, " ");
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cells(char: string): number {
  if (/^\p{Mark}+$/u.test(char)) return 0;
  const point = char.codePointAt(0) ?? 0;
  return /\p{Extended_Pictographic}/u.test(char) ||
    (point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a ||
      (point >= 0x2e80 && point <= 0xa4cf) || (point >= 0xac00 && point <= 0xd7a3) ||
      (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe6f) ||
      (point >= 0xff01 && point <= 0xff60) || (point >= 0xffe0 && point <= 0xffe6) ||
      (point >= 0x20000 && point <= 0x3fffd))) ? 2 : 1;
}

export function cellWidth(text: string): number {
  return [...segmenter.segment(text)].reduce((sum, part) => sum + cells(part.segment), 0);
}

/** Hard wrapping inside a viewport keeps every character reachable by scrolling. */
export function fold(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const { segment } of segmenter.segment(safeText(text))) {
    const size = cells(segment);
    if (used + size > width && line) {
      const boundary = line.lastIndexOf(" ");
      if (boundary > 0) {
        lines.push(line.slice(0, boundary));
        line = line.slice(boundary + 1);
        used = cellWidth(line);
      } else {
        lines.push(line);
        line = "";
        used = 0;
      }
    }
    line += segment;
    used += size;
  }
  return [...lines, line];
}

export function fit(text: string, width: number): string {
  const clean = safeText(text);
  const value = cellWidth(clean) <= width ? clean : `${fold(clean, Math.max(1, width - 1))[0]}…`;
  return value + " ".repeat(Math.max(0, width - cellWidth(value)));
}
