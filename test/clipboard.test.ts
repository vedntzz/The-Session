import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyToClipboard } from "../src/commands/week.js";

/**
 * `week --copy` without an injected `copy`: the platform's own clipboard
 * program, fed on stdin.
 *
 * Nobody's clipboard is touched. A directory of stand-ins named `pbcopy`,
 * `clip` and `xclip` goes first on PATH; each writes what it was given to a
 * file, so a test can read back exactly what would have reached the board and
 * which arguments the program was run with.
 */

let dir: string;
let out: string;
const saved = { path: process.env.PATH, platform: process.platform };

const STAND_IN = `#!/bin/sh
printf '%s' "$*" > "$CLIPBOARD_OUT.args"
cat > "$CLIPBOARD_OUT"
exit "\${CLIPBOARD_EXIT:-0}"
`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "session-clipboard-"));
  out = path.join(dir, "board");
  for (const name of ["pbcopy", "clip", "xclip"]) {
    const file = path.join(dir, name);
    await writeFile(file, STAND_IN, "utf8");
    await chmod(file, 0o755);
  }
  process.env.PATH = `${dir}${path.delimiter}${saved.path ?? ""}`;
  process.env.CLIPBOARD_OUT = out;
  delete process.env.CLIPBOARD_EXIT;
});

afterEach(async () => {
  process.env.PATH = saved.path;
  delete process.env.CLIPBOARD_OUT;
  delete process.env.CLIPBOARD_EXIT;
  Object.defineProperty(process, "platform", { value: saved.platform });
  await rm(dir, { recursive: true, force: true });
});

function on(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

describe.skipIf(process.platform === "win32")("copyToClipboard through the platform's program", () => {
  it("pipes the text into pbcopy on macOS, with no arguments", async () => {
    on("darwin");
    await copyToClipboard("| a | b |\n|---|---|\n");
    expect(await readFile(out, "utf8")).toBe("| a | b |\n|---|---|\n");
    expect(await readFile(`${out}.args`, "utf8")).toBe("");
  });

  it("pipes the text into clip on Windows", async () => {
    on("win32");
    await copyToClipboard("from windows");
    expect(await readFile(out, "utf8")).toBe("from windows");
    expect(await readFile(`${out}.args`, "utf8")).toBe("");
  });

  it("pipes the text into xclip's clipboard selection everywhere else", async () => {
    on("linux");
    await copyToClipboard("from linux");
    expect(await readFile(out, "utf8")).toBe("from linux");
    expect(await readFile(`${out}.args`, "utf8")).toBe("-selection clipboard");
  });

  it("hands over the text byte for byte, as UTF-8", async () => {
    on("darwin");
    const text = "intent · naïve — 日本語\n\ttabbed\n";
    await copyToClipboard(text);
    expect(await readFile(out, "utf8")).toBe(text);
  });

  it("hands over an empty string as an empty board, not a failure", async () => {
    on("darwin");
    await copyToClipboard("");
    expect(await readFile(out, "utf8")).toBe("");
  });

  it("says what to do instead when the program exits non-zero", async () => {
    on("darwin");
    process.env.CLIPBOARD_EXIT = "1";
    await expect(copyToClipboard("text")).rejects.toThrow(
      "Could not reach the clipboard with pbcopy. Run without --copy and pipe the output instead.",
    );
  });

  it("keeps the exit code as the cause, for anyone who asks", async () => {
    on("linux");
    process.env.CLIPBOARD_EXIT = "3";
    const error = await copyToClipboard("text").catch((caught: unknown) => caught);
    expect((error as Error).cause).toBe("xclip exited 3");
  });

  it("says the same when there is no such program, as in a container", async () => {
    on("linux");
    await rm(path.join(dir, "xclip"));
    process.env.PATH = dir;
    await expect(copyToClipboard("text")).rejects.toThrow(
      "Could not reach the clipboard with xclip. Run without --copy and pipe the output instead.",
    );
  });

  it("uses an injected copy instead, and runs no program", async () => {
    on("darwin");
    const copied: string[] = [];
    await copyToClipboard("injected", { copy: async (text) => void copied.push(text) });
    expect(copied).toEqual(["injected"]);
    await expect(readFile(out, "utf8")).rejects.toThrow();
  });
});
