// One review before start. Draft edits stay in memory until explicit acceptance.
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { parseAgreement, proposerOf, type Agreement } from "../agreement.js";
import { currentCommit } from "../git.js";
import type { PrimeProposal } from "../prime.js";
import { formatAgreement } from "../render/agreement.js";
import { plainPalette, type Palette } from "../render/palette.js";
import { terminalWidth } from "../render/terminal/text.js";
import { safeText } from "../render/tui/text.js";
import { assertCanStart, startSession, type StartOptions } from "./start.js";
import type { Session } from "../store.js";

export interface ReviewTerminal {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean; columns?: number };
}

export interface ReviewOptions {
  reviewTerminal?: ReviewTerminal;
}

const CHOICES = "Choose: accept, paths, actions, sensitive, policy, cancel";
const EDIT_PROMPTS: Record<string, string> = {
  paths: 'Accepted paths as a JSON list (example: ["src/", "test/a file.ts"]; [] for none): ',
  actions: 'Actions as a JSON list (create, edit, delete; example: ["create", "edit"]; [] for none): ',
  sensitive: 'Sensitive paths as a JSON list (example: [".env", "credentials/"]; [] for none): ',
  policy: "Policy (record, ask, deny): ",
};

/** Kept opt-in: existing scripts and passive hooks never acquire an input prompt. */
export async function startReviewed(
  intent: string,
  options: Omit<StartOptions, "agreement"> & ReviewOptions & { palette?: Palette } = {},
): Promise<Session | undefined> {
  const terminal = options.reviewTerminal ?? { input: process.stdin, output: process.stdout };
  requireReviewTerminal(terminal);
  await assertCanStart(intent.trim(), options);
  if (!(await currentCommit(options.cwd ?? process.cwd()))) {
    throw new Error("No commits yet, so there is no base to diff against. Make one commit first.");
  }
  const initial = parseAgreement({
    paths: options.scope ?? options.proposal?.scope ?? [],
    actions: ["create", "edit"], sensitivePaths: [], policy: "record",
  });
  const agreement = await reviewAgreement(intent.trim(), initial, options.proposal, terminal, options.palette);
  if (!agreement) return undefined;
  // Recheck the repo at acceptance; opening facts must describe this moment,
  // not the potentially much earlier moment the developer opened the review.
  return startSession(intent, { ...options, agreement, scope: [...agreement.paths] });
}

export function requireReviewTerminal(terminal: ReviewTerminal): void {
  if (!terminal.input.isTTY || !terminal.output.isTTY) {
    throw new Error("--review needs an interactive terminal. Run it in a terminal, or omit --review to start without an agreement.");
  }
}

/** A line-oriented screen: Enter never accepts, and EOF/signals cancel. */
export async function reviewAgreement(
  intent: string,
  initial: Agreement,
  proposal: PrimeProposal | undefined,
  terminal: ReviewTerminal,
  palette: Palette = plainPalette,
): Promise<Agreement | undefined> {
  requireReviewTerminal(terminal);
  if (proposal && proposerOf(proposal) !== "prime") {
    throw new Error("External proposal review is not supported yet. Declare your own terms with session start --review.");
  }
  let draft = parseAgreement(initial);
  const { input, output } = terminal;
  const wasFlowing = input.readableFlowing === true;
  // Cooked terminal input owns line editing; this screen emits no cursor codes.
  const reader = createInterface({ input, terminal: false, crlfDelay: Infinity });
  const answers = reader[Symbol.asyncIterator]();
  let cancelled = false;
  let outputError: Error | undefined;
  const cancel = (code: number): void => { cancelled = true; process.exitCode = code; reader.close(); };
  const interrupt = (): void => cancel(130);
  const terminate = (): void => cancel(143);
  const hangup = (): void => cancel(129);
  const failed = (error: Error): void => { outputError = error; reader.close(); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  output.on("error", failed);
  const ask = async (prompt: string): Promise<string | undefined> => {
    output.write(prompt);
    const answer = await answers.next();
    if (outputError) throw outputError;
    return cancelled || answer.done ? undefined : answer.value;
  };
  try {
    for (;;) {
      output.write(formatAgreement(intent, draft, proposal, palette, terminalWidth(output)).join("\n") + "\n");
      const answer = await ask(`${CHOICES}\n> `);
      if (answer === undefined || answer.trim().toLowerCase() === "cancel") return undefined;
      const choice = answer.trim().toLowerCase();
      if (choice === "accept") {
        if (proposal && draft.paths.length === 0) {
          output.write("Prime has no accepted scope. Choose paths and supply a nonempty list before accepting.\n");
          continue;
        }
        return draft;
      }
      if (!Object.hasOwn(EDIT_PROMPTS, choice)) {
        output.write("No terms changed. Type a listed choice; only accept starts the session.\n");
        continue;
      }
      const edit = await ask(EDIT_PROMPTS[choice]!);
      if (edit === undefined) return undefined;
      if (!edit.trim()) {
        output.write("No terms changed. An empty answer keeps the current value.\n");
        continue;
      }
      try {
        const field = choice === "sensitive" ? "sensitivePaths" : choice;
        const value: unknown = choice === "policy" ? edit.trim().toLowerCase() : JSON.parse(edit);
        draft = parseAgreement({ ...draft, [field]: value });
      } catch (error) {
        const detail = error instanceof SyntaxError
          ? 'Use a JSON list of quoted values, such as ["src/"]; [] means none.'
          : safeText(error instanceof Error ? error.message : String(error));
        output.write(`No terms changed. ${detail}\n`);
      }
    }
  } finally {
    reader.close();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    output.off("error", failed);
    if (!wasFlowing) input.pause();
  }
}
