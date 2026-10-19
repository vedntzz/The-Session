// `session pr`.
import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { prBody } from "../commands/pr.js";
import { copyToClipboard } from "../commands/week.js";
import { cardDataForRange } from "../pr-card/card-for-range.js";
import { renderCardJson } from "../pr-card/render-card-json.js";
import { renderNoRecordCard } from "../pr-card/render-no-record-card.js";
import { postTarget } from "../pr-card/post-target.js";
import { renderPrCard } from "../pr-card/render-pr-card.js";
import { upsertCardComment } from "../pr-card/upsert-card-comment.js";
import { placeholderList } from "../render/pr.js";
import type { ProgramOptions } from "./options.js";

/** What `session pr` accepts, as commander hands it over. */
export type PrFlags = {
  copy?: boolean;
  out?: string;
  template?: string;
  card?: boolean;
  json?: boolean;
  base?: string;
  head?: string;
  post?: boolean;
  pr?: string;
  showIntent?: boolean;
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
 *
 * `--post` is the GitHub Action's line: the card upserted as the PR's one card
 * comment, with the recorded intent left off unless `--show-intent` asks for it.
 */
export function registerPr(program: Command, options: ProgramOptions): void {
  program
    .command("pr")
    .description("Write a pull request body from a session's record")
    .argument("[id]", "a session id, or an unambiguous prefix of one")
    .option("--copy", "put it on the clipboard instead of printing it")
    .option("--out <path>", "write it to a file instead of printing it")
    .option("--template <path>", `a Markdown file with ${placeholderList()} in it`)
    .option("--card", "print the PR card for a commit range instead")
    .option("--json", "print the PR card's data as JSON instead")
    .option("--base <ref>", "with --card or --json: where the PR starts (default: merge base with the default branch)")
    .option("--head <ref>", "with --card or --json: where the PR ends (default: HEAD)")
    .option("--post", "post the card as the PR's one card comment (reads GITHUB_TOKEN and GITHUB_REPOSITORY)")
    .option("--pr <number>", "with --post: the pull request to post on")
    .option("--show-intent", "with --post: put the recorded intent on the card")
    .action(async (id: string | undefined, flags: PrFlags) => {
      if (flags.post === true) return postCard(id, flags, options);
      if (flags.pr !== undefined || flags.showIntent === true) {
        throw new Error("--pr and --show-intent need --post. Run session pr --post --pr <number>.");
      }
      if (flags.card === true || flags.json === true) return emitCard(id, flags, options);
      if (flags.base !== undefined || flags.head !== undefined) {
        throw new Error("--base and --head need --card or --json. Run session pr --card --base <ref> --head <ref>.");
      }
      await emitBody(id, flags, options);
    });
}

/** The card for a commit range, as Markdown with --card or as JSON with --json. */
async function emitCard(id: string | undefined, flags: PrFlags, options: ProgramOptions): Promise<void> {
  if (flags.card === true && flags.json === true) throw new Error("choose --card or --json");
  const flag = flags.json === true ? "--json" : "--card";
  if (id !== undefined) throw new Error(`${flag} works on a commit range; drop the session id.`);
  const card = await cardDataForRange(flags, options);
  if (flags.json === true) console.log(renderCardJson(card));
  else console.log(card === null ? renderNoRecordCard() : renderPrCard(card));
}

/** The card for a range, upserted as the PR's one card comment; prints what that did and the comment's id. */
async function postCard(id: string | undefined, flags: PrFlags, options: ProgramOptions): Promise<void> {
  const extra = [id !== undefined && "a session id", flags.card && "--card", flags.json && "--json", flags.copy && "--copy", flags.out !== undefined && "--out", flags.template !== undefined && "--template"].filter(Boolean);
  if (extra.length > 0) throw new Error(`--post posts the card for a commit range; drop ${extra.join(", ")}.`);
  const { target, token } = postTarget(flags.pr, options.env ?? process.env);
  const card = await cardDataForRange(flags, options);
  const body = card === null ? renderNoRecordCard() : renderPrCard(card, { showIntent: flags.showIntent === true });
  const result = await upsertCardComment(target, body, token, options.fetch);
  console.log(`  ${result.action.padEnd(10)}comment ${result.id}`);
}

/** The body, to a file, the clipboard, or stdout. */
async function emitBody(id: string | undefined, flags: PrFlags, options: ProgramOptions): Promise<void> {
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
}
