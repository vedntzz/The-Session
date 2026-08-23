// Every command ends the same way: a renderer returns lines, this prints them.
/**
 * Prints a view. Every command below ends this way — a renderer returns the
 * lines and the command puts them on stdout — so it is one function rather
 * than the same loop written fifteen times.
 */
export function printLines(lines: Iterable<string>): void {
  for (const line of lines) {
    console.log(line);
  }
}
