import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import type { MoveRequest } from "../shell/move.js";
import { resolveFileWrite, type WriteResolution } from "./resolve-write.js";

export type MoveResolution = WriteResolution | {
  kind: "blocked";
  reason: "unsupported-move" | "missing-source" | "symlink-operand" | "same-file";
};

/**
 * Read-only snapshot for regular-file to file moves only. Reuse the trusted
 * root/path checks, but never follow a leaf symlink: mv renames the link,
 * whereas a write through it changes the target. Directory moves remain
 * unsupported until their full effects can be enumerated.
 */
export async function resolveMove(request: MoveRequest, cwd: string, repo: string): Promise<MoveResolution> {
  if (request.kind !== "move" || !["default", "force", "interactive", "no-clobber"].includes(request.overwrite)) {
    return { kind: "blocked", reason: "unsupported-move" };
  }
  try {
    const source = await resolveFileWrite({ cwd, filePath: request.source }, repo);
    if (source.kind === "blocked") return source;
    if (source.writes.some((write) => write.action !== "edit")) return { kind: "blocked", reason: "missing-source" };
    const sourcePath = path.resolve(cwd, request.source);
    if ((await lstat(sourcePath)).isSymbolicLink()) return { kind: "blocked", reason: "symlink-operand" };

    const destination = await resolveFileWrite({ cwd, filePath: request.destination }, repo);
    if (destination.kind === "blocked") return destination;
    const destinationPath = path.resolve(cwd, request.destination);
    try {
      if ((await lstat(destinationPath)).isSymbolicLink()) return { kind: "blocked", reason: "symlink-operand" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // mv cannot create missing parent directories. Do not predict a create
    // merely because the generic file-write resolver permits missing parents.
    if (!(await stat(path.dirname(destinationPath))).isDirectory()) return { kind: "blocked", reason: "not-file" };
    if (source.writes.some((from) => destination.writes.some((to) => from.path === to.path))) {
      return { kind: "blocked", reason: "same-file" };
    }
    // No-clobber/interactive can skip the move. Include potential effects
    // rather than claim permission, a successful move, or a guaranteed no-op.
    return { kind: "resolved", writes: [
      ...source.writes.map((write) => ({ path: write.path, action: "delete" as const })),
      ...destination.writes,
    ] };
  } catch {
    return { kind: "blocked", reason: "filesystem-error" };
  }
}
