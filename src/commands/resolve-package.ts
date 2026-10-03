// Where an npm, pnpm or yarn command writes. The parser names the manifest and
// lockfile relative to the command's directory; a package manager does not
// work there. It walks up to the nearest package.json, and up again to a
// workspace root, so `npm install x` from `src/` writes the root's files while
// the parser named `src/package.json`. Checking the wrong path is worse than
// asking: a compliant-looking path lets the real write through in silence.
// So the parse is trusted only where the walk cannot move: at the checkout
// root, over a package.json that is a regular file there. Metadata only — no
// file here is read.
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { ShellWrites } from "../shell/package-manager.js";

async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * True when the parsed paths are where this command writes: it runs at the
 * checkout root, and a package.json is there to stop the walk.
 * Anything the filesystem cannot answer is false, which the caller turns into
 * a question rather than silence.
 */
export async function packageManagerAtRoot(_command: string, cwd: string, repo: string): Promise<boolean> {
  try {
    const [here, root] = await Promise.all([realpath(cwd), realpath(repo)]);
    return here === root && (await isRegularFile(path.join(root, "package.json")));
  } catch {
    return false;
  }
}

/** A package-manager parse kept only where `packageManagerAtRoot` holds; otherwise unknown. */
export async function packageWritesHere(
  writes: ShellWrites, command: string, cwd: string, repo: string,
): Promise<ShellWrites> {
  if (writes.kind !== "writes") return writes;
  return (await packageManagerAtRoot(command, cwd, repo)) ? writes : { kind: "unknown" };
}
