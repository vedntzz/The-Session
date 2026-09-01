// `session pr`.
import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { prBody } from "../commands/pr.js";
import { copyToClipboard } from "../commands/week.js";
import { placeholderList } from "../render/pr.js";
import type { ProgramOptions } from "./options.js";

/** What `session pr` accepts, as commander hands it over. */
export type PrFlags = {
  copy?: boolean;
  out?: string;
  template?: string;
};

/**
 * `session pr` — the pull request description the record already contains.
 *
 * Stdout by default, and that is the whole interface: the document is meant to
 * be piped, and `session pr | gh pr create --body-file -` is the line this
 * command exists for. Nothing else is printed on the way — no sweep notice, no
 * confirmation — because anything else on stdout ends up in the pull request.
 *
 * `--copy` and `--out` are the two other places a body ever goes, and both say
 * what they did on stdout instead of the document, since neither leaves
 * anything to pipe.
 */
export function registerPr(program: Command, options: ProgramOptions): void {
  program
    .command("pr")
    .description("Write a pull request body from a session's record")
    .argument("[id]", "a session id, or an unambiguous prefix of one")
    .option("--copy", "put it on the clipboard instead of printing it")
    .option("--out <path>", "write it to a file instead of printing it")
    .option("--template <path>", `a Markdown file with ${placeholderList()} in it`)
    .action(async (id: string | undefined, flags: PrFlags) => {
      const body = await prBody(id, options, flags.template);

      if (flags.out !== undefined) {
        // A newline the document itself does not carry: a file ends in one,
        // and a paste should not.
        await writeFile(flags.out, `${body}\n`, "utf8");
        console.log(`  wrote    ${flags.out}`);
      }
      if (flags.copy === true) {
        await copyToClipboard(body, options);
        console.log("  copied   the pull request body");
      }
      if (flags.out === undefined && flags.copy !== true) {
        console.log(body);
      }
    });
}
