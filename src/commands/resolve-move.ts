import type { MoveRequest } from "../shell/move.js";
import type { WriteResolution } from "./resolve-write.js";
import { resolveFilePair, type FilePairBlocked } from "./resolve-file-pair.js";

export type MoveResolution = WriteResolution | FilePairBlocked | {
  kind: "blocked"; reason: "unsupported-move";
};

/** Read-only regular-file snapshot. Keep source deletion separate from the
 * destination write, including both requested and physical parent aliases.
 * This is not an atomic sandbox or proof that a conditional move will happen.
 */
export async function resolveMove(request: MoveRequest, cwd: string, repo: string): Promise<MoveResolution> {
  if (request.kind !== "move" || !["default", "force", "interactive", "no-clobber"].includes(request.overwrite)) {
    return { kind: "blocked", reason: "unsupported-move" };
  }
  const pair = await resolveFilePair(request.source, request.destination, cwd, repo);
  if (pair.kind === "blocked") return pair;
  return { kind: "resolved", writes: [
    ...pair.source.map((write) => ({ path: write.path, action: "delete" as const })),
    ...pair.destination,
  ] };
}
