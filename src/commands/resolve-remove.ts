import { lstat } from "node:fs/promises";
import path from "node:path";
import type { AgreementWrite } from "../agreement-decision.js";
import type { RemoveRequest } from "../shell/remove.js";
import { resolveFileWrite, type WriteResolution } from "./resolve-write.js";

export type RemoveResolution = WriteResolution | {
  kind: "blocked"; reason: "unsupported-remove" | "symlink-operand";
};

/**
 * Read-only snapshot of what an rm would delete: every operand, as `delete`,
 * with parent-directory aliases kept. A missing operand is still a `delete` —
 * it may exist by the time the command runs, and `-f` only silences the error.
 * A leaf symlink is refused: rm removes the link, not the file it names, and
 * neither name alone describes that. Directories, hard links, escapes and
 * unresolved paths are blocked by resolveFileWrite. Any one blocked operand
 * blocks the whole command; a partial answer would hide the rest.
 */
export async function resolveRemove(request: RemoveRequest, cwd: string, repo: string): Promise<RemoveResolution> {
  if (request.kind !== "remove" || request.paths.length === 0) {
    return { kind: "blocked", reason: "unsupported-remove" };
  }
  const writes = new Map<string, AgreementWrite>();
  try {
    for (const operand of request.paths) {
      const resolved = await resolveFileWrite({ cwd, filePath: operand }, repo);
      if (resolved.kind === "blocked") return resolved;
      try {
        if ((await lstat(path.resolve(cwd, operand))).isSymbolicLink()) {
          return { kind: "blocked", reason: "symlink-operand" };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      for (const write of resolved.writes) writes.set(write.path, { path: write.path, action: "delete" });
    }
  } catch {
    return { kind: "blocked", reason: "filesystem-error" };
  }
  return { kind: "resolved", writes: [...writes.values()] };
}
