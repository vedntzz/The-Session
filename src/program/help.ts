// The short `--help` surface and `help all`, both read off the command tree.
import { Command, Help } from "commander";
import { formatCommands, type CommandEntry } from "../render/terminal.js";
import type { Palette } from "../render/palette.js";
import { printLines } from "./print.js";

/**
 * The commands `session --help` lists, beside the bare screen itself.
 *
 * Three. Not because the others are unfinished or deprecated — they all work
 * and are all documented — but because a first reader cannot use fifteen
 * commands and can use these: start a session, look at the week, find the
 * rest. A help screen that lists everything is a help screen nobody finishes
 * reading, and the commands that get lost in it are the ones a newcomer most
 * needs.
 *
 * Discoverability is not sacrificed, it is deferred: `session help all` is on
 * the short list, and the line under it names what is behind it.
 */
export const BRIEF_COMMANDS = ["start", "week", "help"];

/**
 * Narrows the top-level help to `BRIEF_COMMANDS` and nothing else.
 *
 * Both overrides are guarded on the command being rendered, because commander
 * calls them for every help screen in the tree. `session config --help` and
 * every other subcommand's help go through commander's own rendering, because
 * there is nothing to hide there — a reader who has typed `session config` has
 * already chosen the topic.
 *
 * The guard on `subcommandTerm` is the parent, not the name: commander gives
 * every command with subcommands an implicit `help` of its own, and a term
 * matched on the name alone renamed those too — `session hook --help` listed
 * `help all`, advertising a `session hook help all` that does not exist. The
 * implicit ones carry no parent; ours is a real command on the root.
 */
export function configureHelp(program: Command): void {
  // A row for the bare screen. It is not a subcommand and there is nothing to
  // dispatch to; it is here because it is the shortest thing to type and a
  // list of entry points that leaves out the shortest one hides it.
  const home = new Command("session").description("where this repo stands, and what to run next");

  // Declared on the root so an unknown command can be named as one — see
  // `registerHome`. Commander would then print `[command] [command]`, once for
  // the argument and once for the subcommands it already knew about.
  program.usage("[options] [command]");

  program.configureHelp({
    visibleArguments(cmd) {
      // The root's `[command]` is a parsing seam, not something to explain: the
      // list of commands is the next thing on the screen, and an `Arguments`
      // section above it saying a command is a command is a section that costs
      // a first reader more than it tells them.
      return cmd === program ? [] : Help.prototype.visibleArguments.call(this, cmd);
    },
    visibleCommands(cmd) {
      if (cmd !== program) {
        return Help.prototype.visibleCommands.call(this, cmd);
      }
      // Filtered out of the real tree rather than listed separately, so a
      // command renamed here cannot fall off this list silently.
      return [home, ...program.commands.filter((sub) => BRIEF_COMMANDS.includes(sub.name()))];
    },
    subcommandTerm(cmd) {
      // There is exactly one topic, so the term says it rather than leaving
      // the reader to guess what a `[topic]` might be. Only the root's own
      // `help` — the one `registerHelp` added — takes the topic with it.
      return cmd.name() === "help" && cmd.parent === program
        ? "help all"
        : Help.prototype.subcommandTerm.call(this, cmd);
    },
  });

  // A function, so it is built when the help is printed rather than when this
  // runs — `registerCommands` has not happened yet. Written out by hand this
  // sentence was one release from being wrong, and it was: `scan` shipped and
  // the list still named ten commands.
  program.addHelpText("after", () => `\n${everythingElse(program)}`);
}

/** Width the footer sentence wraps at, matching the help above it. */
export const HELP_WIDTH = 78;

/**
 * The sentence under the short help: what it left out, and where to find it.
 *
 * Read off the command tree, like `session help all` and for the same reason.
 * The short list is a decision about what a first reader can use; this is a
 * statement about what exists, and a statement about what exists may not be
 * kept by hand.
 */
export function everythingElse(program: Command): string {
  const rest = program.commands
    .map((command) => command.name())
    .filter((name) => !BRIEF_COMMANDS.includes(name) && name !== "help");

  if (rest.length === 0) {
    return "Everything is listed above.";
  }
  return wrap(
    `Everything else — ${rest.join(", ")} — still works and is listed under ` +
      `${HELP_ALL.replaceAll(" ", "\u0000")}.`,
    HELP_WIDTH,
  );
}

/**
 * The command the sentence points at, kept whole.
 *
 * It is something the reader is meant to type, so a line break through the
 * middle of it turns the one actionable thing in the sentence into two halves
 * that have to be reassembled by hand.
 */
export const HELP_ALL = "session help all";

/**
 * Greedy wrap on spaces. The sentence is prose, so words stay whole — and
 * `HELP_ALL` counts as one word, however many spaces are in it.
 */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  const atomic = "\u0000";
  for (const token of text.split(" ")) {
    const word = token.replaceAll(atomic, " ");
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line !== "") {
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Every command in the tree, parent and child, as `session help all` prints
 * them.
 *
 * Read off the tree rather than kept in a list beside it. A hand-maintained
 * list is one release away from being wrong, and the whole point of this
 * command is that it is the place where nothing is left out.
 */
export function commandEntries(program: Command): CommandEntry[] {
  return program.commands.flatMap((command) => [
    { name: command.name(), description: command.description() },
    ...command.commands.map((sub) => ({
      name: `${command.name()} ${sub.name()}`,
      description: sub.description(),
    })),
  ]);
}

export function registerHelp(program: Command, palette: Palette): void {
  program
    .command("help")
    .description("Every command, not just the ones above")
    .argument("[topic]", 'the only topic is "all"')
    .action((topic: string | undefined) => {
      if (topic === undefined) {
        program.outputHelp();
        return;
      }
      if (topic !== "all") {
        throw new Error(`No help topic ${topic}. The only one is: session help all.`);
      }
      printLines(formatCommands(commandEntries(program), palette));
    });
}

// --- a command nobody has ------------------------------------------------

/**
 * How far apart two names may be and still be offered as what was meant.
 *
 * One edit covers the mistakes people actually make at a prompt — a dropped
 * letter (`wek`), a doubled one (`weekk`), a wrong one (`weak`), two swapped
 * (`weke`). Two would start offering `week` for `work`, and a suggestion that
 * is wrong as often as it is right is one the reader learns to read past.
 */
const NEAR = 1;

/**
 * Damerau-Levenshtein distance: edits, counting a swap of two neighbours as
 * one rather than as two.
 *
 * The swap is the reason it is this and not plain Levenshtein. Transposing two
 * letters is the commonest thing fingers do at a prompt, and plain Levenshtein
 * scores it 2 — which, at `NEAR`, is the difference between `session weke`
 * being answered and being shrugged at.
 *
 * Written out rather than taken from a dependency: it is a dozen lines, it is
 * called once per command on the one keystroke somebody got wrong, and this
 * tool has two dependencies on purpose.
 */
function distance(a: string, b: string): number {
  const rows: number[][] = [[...Array(b.length + 1).keys()]];
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (row[j - 1] as number) + 1,
        ((rows[i - 1] as number[])[j] as number) + 1,
        ((rows[i - 1] as number[])[j - 1] as number) + cost,
      );
      // The two neighbours each side are the same pair, the wrong way round.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, ((rows[i - 2] as number[])[j - 2] as number) + 1);
      }
      row.push(best);
    }
    rows.push(row);
  }
  return (rows[a.length] as number[])[b.length] as number;
}

/**
 * What was probably meant, out of the commands there are.
 *
 * A prefix first — somebody typing `sur` for `survival` has not made a typo,
 * they have stopped early, and no edit distance describes that. Then the
 * nearest name within `NEAR`, nearest first, so the closest guess is the one
 * offered.
 */
export function didYouMean(typed: string, names: readonly string[]): string | undefined {
  const wanted = typed.toLowerCase();
  const prefix = names.filter((name) => name.startsWith(wanted));
  if (prefix.length === 1) {
    return prefix[0];
  }
  const near = names
    .map((name) => ({ name, gap: distance(wanted, name) }))
    .filter((found) => found.gap <= NEAR)
    .sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));
  return near[0]?.name;
}

/**
 * What `session wek` says.
 *
 * Commander's own answer here is "error: too many arguments. Expected 0
 * arguments but got 1" — true of the parse and useless to the reader, who did
 * not think they were passing an argument to anything. It reads that way
 * because the root command has an action of its own, the bare state screen, so
 * a name that matches no subcommand arrives as a stray argument to it rather
 * than as the unknown command it is.
 *
 * Three parts, in the order they are acted on: what is wrong, what was
 * probably meant, and where the list is. The guess is offered only when there
 * is one — a made-up suggestion costs more than none, since the reader tries
 * it before they read the rest of the line.
 */
export function unknownCommand(typed: string, program: Command): string {
  const names = program.commands.map((command) => command.name());
  const meant = didYouMean(typed, names);
  const guess = meant === undefined ? "" : ` Did you mean session ${meant}?`;
  return `No command ${typed}.${guess} Run ${HELP_ALL} for every command.`;
}
