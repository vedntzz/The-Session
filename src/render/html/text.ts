// Escaping and the two number formats, on their own so every part of the page
// reaches the same ones.

/** Everything that could close a tag or an attribute early. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Grouped digits, so a column of them can be compared down the page. */
export function figure(value: number): string {
  return value.toLocaleString("en-US");
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
