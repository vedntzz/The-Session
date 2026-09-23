// A shell command's words, when the command is simple enough to know them.
// Anything the shell would expand, redirect, chain or substitute is refused
// rather than approximated: the caller treats "unknown" as "can't tell what
// this writes", never as "writes nothing".

/** Characters that make an unquoted word mean something other than itself. */
const SPECIAL = /[;&|<>()$`\\*?[\]{}~!#\n\r]/;

/**
 * The words of one simple command, or undefined when the command is anything
 * more: a chain, a pipe, a redirect, a substitution, a glob, an environment
 * assignment, or quoting this reader does not model. Single quotes are
 * literal; double quotes are accepted only when nothing inside them could
 * expand.
 */
export function simpleWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word: string | undefined;
  let i = 0;
  while (i < command.length) {
    const char = command[i]!;
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
      i++;
    } else if (char === "'" || char === '"') {
      const end = command.indexOf(char, i + 1);
      if (end === -1) return undefined;
      const quoted = command.slice(i + 1, end);
      if (char === '"' && /[$`\\!]/.test(quoted)) return undefined;
      word = (word ?? "") + quoted;
      i = end + 1;
    } else if (SPECIAL.test(char)) {
      return undefined;
    } else {
      word = (word ?? "") + char;
      i++;
    }
  }
  if (word !== undefined) words.push(word);
  // `NAME=value cmd` changes the environment the command runs in.
  if (words.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) return undefined;
  return words;
}
