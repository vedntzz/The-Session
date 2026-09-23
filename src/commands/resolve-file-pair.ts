import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import type { AgreementWrite } from "../agreement-decision.js";
import { resolveFileWrite, type WriteResolution } from "./resolve-write.js";

export type FilePairBlocked = Extract<WriteResolution, { kind: "blocked" }> | {
  kind: "blocked"; reason: "missing-source" | "symlink-operand" | "same-file";
};
type FilePairResolution = FilePairBlocked | {
  kind: "resolved"; source: readonly AgreementWrite[]; destination: readonly AgreementWrite[];
};

/** Shared metadata-only checks, not operation semantics. Source must exist;
 * destination must be a regular file or an absent leaf with an existing parent.
 * Both stay inside the trusted root. Leaf links and directories are refused.
 * Source actions from resolveFileWrite describe existence, not an actual write.
 */
export async function resolveFilePair(
  sourcePath: string, destinationPath: string, cwd: string, repo: string,
): Promise<FilePairResolution> {
  try {
    const source = await resolveFileWrite({ cwd, filePath: sourcePath }, repo);
    if (source.kind === "blocked") return source;
    if (source.writes.some((write) => write.action !== "edit")) return { kind: "blocked", reason: "missing-source" };
    if ((await lstat(path.resolve(cwd, sourcePath))).isSymbolicLink()) return { kind: "blocked", reason: "symlink-operand" };
    const destination = await resolveFileWrite({ cwd, filePath: destinationPath }, repo);
    if (destination.kind === "blocked") return destination;
    const target = path.resolve(cwd, destinationPath);
    try {
      if ((await lstat(target)).isSymbolicLink()) return { kind: "blocked", reason: "symlink-operand" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!(await stat(path.dirname(target))).isDirectory()) return { kind: "blocked", reason: "not-file" };
    if (source.writes.some((from) => destination.writes.some((to) => from.path === to.path))) {
      return { kind: "blocked", reason: "same-file" };
    }
    return { kind: "resolved", source: source.writes, destination: destination.writes };
  } catch {
    return { kind: "blocked", reason: "filesystem-error" };
  }
}
