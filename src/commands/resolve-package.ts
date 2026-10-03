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
import { simpleWords } from "../shell/words.js";

/**
 * Files that mean yarn runs Plug'n'Play or Berry, which writes tracked files
 * the parser does not list: the loader, install state, and the zip cache in a
 * zero-install repository.
 */
const YARN_PNP = [".pnp.cjs", ".pnp.js", ".pnp.loader.mjs", ".yarnrc.yml"];

async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the parsed paths are where this command writes: it runs at the
 * checkout root, a package.json is there to stop the walk, and, for yarn, no
 * Plug'n'Play files say it writes more than the manifest and lockfile.
 * Anything the filesystem cannot answer is false, which the caller turns into
 * a question rather than silence.
 */
export async function packageManagerAtRoot(command: string, cwd: string, repo: string): Promise<boolean> {
  try {
    const [here, root] = await Promise.all([realpath(cwd), realpath(repo)]);
    if (here !== root || !(await isRegularFile(path.join(root, "package.json")))) return false;
    if (simpleWords(command)?.[0] !== "yarn") return true;
    const pnp = await Promise.all(YARN_PNP.map((name) => exists(path.join(root, name))));
    return !pnp.some(Boolean);
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
