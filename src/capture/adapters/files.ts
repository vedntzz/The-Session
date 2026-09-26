// Filesystem questions every adapter asks of the directory its tool writes to.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * True when two working directories belong to the same checkout. Compared
 * both ways because `session stop` may run from a subdirectory of the repo
 * the agent was started in, or the other way round.
 */
export function relatedPaths(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep);
}

/** What a directory holds, or nothing where there is no directory to read. */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return []; // the tool has never run here
  }
}

/**
 * True when the file was last written inside the window. A file older than
 * that cannot contain anything inside it, so this skips most history cheaply.
 */
export async function touchedSince(file: string, from: number): Promise<boolean> {
  try {
    return (await stat(file)).mtimeMs >= from;
  } catch {
    return false;
  }
}

export async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
