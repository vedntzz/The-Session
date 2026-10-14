import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { WeekOptions } from "./week.js";

const execFileAsync = promisify(execFile);

/**
 * Puts text on the system clipboard.
 *
 * Through the platform's own utility and its stdin, rather than a dependency:
 * the whole of what this needs is a pipe into one of three programs, and a
 * package that shells out to the same three would be a supply chain for it.
 *
 * A machine with no clipboard — a container, a bare ssh session — is the
 * common case for the last of these, so the failure says what to do instead
 * rather than reporting that a program is missing.
 */
export async function copyToClipboard(text: string, options: WeekOptions = {}): Promise<void> {
  if (options.copy) {
    return options.copy(text);
  }

  const [command, args] = clipboardCommand();
  await pipeInto(command, args, text);
}

/** The one program on this platform that takes stdin and puts it on the board. */
function clipboardCommand(): [string, string[]] {
  if (process.platform === "darwin") {
    return ["pbcopy", []];
  }
  if (process.platform === "win32") {
    return ["clip", []];
  }
  return ["xclip", ["-selection", "clipboard"]];
}

/**
 * Writes the text to the program's stdin and waits for it to exit cleanly.
 *
 * A machine with no clipboard — a container, a bare ssh session — is the
 * common case for the last of these, so the failure says what to do instead
 * rather than reporting that a program is missing.
 */
async function pipeInto(command: string, args: readonly string[], text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["pipe", "ignore", "ignore"] });
    const failed = (cause: unknown): void => {
      reject(
        new Error(
          `Could not reach the clipboard with ${command}. Run without --copy and pipe the output instead.`,
          { cause },
        ),
      );
    };

    child.on("error", failed);
    child.on("close", (code) => (code === 0 ? resolve() : failed(`${command} exited ${code}`)));
    child.stdin.on("error", failed);
    child.stdin.end(text, "utf8");
  });
}

/** Hands the file to whatever the desktop uses to open one. */
export async function openInBrowser(file: string, options: WeekOptions = {}): Promise<void> {
  if (options.launch) {
    return options.launch(file);
  }

  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];

  try {
    await execFileAsync(command, args);
  } catch (error) {
    throw new Error(`Could not open a browser with ${command}. Open ${file} yourself.`, {
      cause: error,
    });
  }
}
