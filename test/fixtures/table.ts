/** Read one labelled field without depending on row positions or border widths. */
export function tableValues(lines: readonly string[], name: string): string[] {
  const values: string[] = [];
  let selected = false;
  for (const line of lines) {
    if (!line.startsWith("  │ ")) continue;
    const parts = line.split("│");
    const label = parts[1]?.trim();
    if (label === name) selected = true;
    else if (selected && label) break;
    if (selected) values.push(parts.slice(2, -1).join("│").slice(1, -1).trimEnd());
  }
  return values;
}
