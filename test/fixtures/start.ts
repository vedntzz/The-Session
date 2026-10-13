/** Remove terminal frame decoration when asserting the existing labelled rows. */
export function withoutStartFrame(lines: readonly string[]): string[] {
  return lines.flatMap(line => {
    if (/^  [╭╰├]─+[╮╯┤]$/u.test(line)) return [];
    if (!line.startsWith("  │ ")) return [line];
    const content = line.slice(4, -2).trimEnd();
    return [content ? "  " + content : ""];
  });
}
