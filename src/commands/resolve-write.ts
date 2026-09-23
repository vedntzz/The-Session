import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { agreementPaths } from "../agreement.js";
import type { AgreementWrite } from "../agreement-decision.js";
import type { FileWriteRequest } from "../capture/write-request.js";

export type WriteResolution =
  | { kind: "resolved"; writes: readonly AgreementWrite[] }
  | { kind: "blocked"; reason: "invalid-path" | "outside-repo" | "not-file" | "hard-linked-file" | "filesystem-error" };

const blocked = (reason: Extract<WriteResolution, { kind: "blocked" }>["reason"]): WriteResolution =>
  ({ kind: "blocked", reason });

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validPath(value: string): boolean {
  // Do not collapse .. before resolving symlinks: that changes filesystem meaning.
  return value.length > 0 && value.trim() === value && !/[\x00-\x1f\x7f-\x9f]/u.test(value) &&
    !(path.sep === "/" && (value.includes("\\") || /^[a-z]:/i.test(value))) &&
    !value.split(path.sep).includes("..");
}

/** Find this root's spelling through cwd, e.g. /tmp versus /private/tmp on macOS. */
async function rootThroughCwd(cwd: string, root: string): Promise<string | undefined> {
  let cursor = cwd;
  for (;;) {
    const resolved = await realpath(cursor);
    if (resolved === root) return cursor;
    if (!inside(root, resolved)) return undefined;
    const parent = path.dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

function portable(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

/**
 * Read-only filesystem snapshot. repo is a trusted root supplied by the caller,
 * never chosen from the payload. Check every returned write against the same
 * agreement: requested aliases cannot hide sensitive resolved targets or vice
 * versa. This is not an atomic sandbox against concurrent filesystem changes.
 */
export async function resolveFileWrite(request: FileWriteRequest, repo: string): Promise<WriteResolution> {
  if (!validPath(repo) || !path.isAbsolute(repo) || !validPath(request.cwd) || !path.isAbsolute(request.cwd) ||
    !validPath(request.filePath) || request.filePath.endsWith(path.sep) ||
    request.filePath.split(path.sep).at(-1) === ".") return blocked("invalid-path");
  try {
    const root = await realpath(repo);
    const cwd = await realpath(request.cwd);
    if (!(await stat(root)).isDirectory() || !(await stat(cwd)).isDirectory()) return blocked("not-file");
    if (!inside(root, cwd)) return blocked("outside-repo");
    const target = path.resolve(request.cwd, request.filePath);
    const aliases = [path.resolve(repo), root, await rootThroughCwd(path.resolve(request.cwd), root)];
    const spelling = aliases.find((alias): alias is string => alias !== undefined && inside(alias, target));
    if (spelling === undefined) return blocked("outside-repo");
    const requested = portable(spelling, target);
    if (!requested) return blocked("not-file");
    // Refuse names the existing agreement matcher cannot represent faithfully.
    try {
      if (agreementPaths([requested], "Write path")[0] !== requested) return blocked("invalid-path");
    } catch { return blocked("invalid-path"); }
    return await walk(root, requested);
  } catch {
    // No errno message: it may include paths or other data the caller did not ask to print.
    return blocked("filesystem-error");
  }
}

async function walk(root: string, requested: string): Promise<WriteResolution> {
  const parts = requested.split("/");
  let cursor = root;
  let exists = true;
  for (const [index, part] of parts.entries()) {
    const candidate = path.join(cursor, part);
    let info;
    try { info = await lstat(candidate); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      cursor = path.join(cursor, ...parts.slice(index));
      exists = false;
      break;
    }
    // realpath also catches broken/cyclic links. Do not call a dangling link a new file.
    cursor = await realpath(candidate);
    if (!inside(root, cursor)) return blocked("outside-repo");
    if (info.isSymbolicLink()) info = await stat(cursor);
    const last = index === parts.length - 1;
    if (last ? !info.isFile() : !info.isDirectory()) return blocked("not-file");
    if (last && info.nlink > 1) return blocked("hard-linked-file");
  }
  const resolved = portable(root, cursor);
  try {
    if (agreementPaths([resolved], "Write path")[0] !== resolved) return blocked("invalid-path");
  } catch { return blocked("invalid-path"); }
  return {
    kind: "resolved",
    writes: [...new Set([requested, resolved])].map((file) => ({ path: file, action: exists ? "edit" : "create" })),
  };
}
