import type { CopyRequest } from "../shell/copy.js";
import type { WriteResolution } from "./resolve-write.js";
import { resolveFilePair, type FilePairBlocked } from "./resolve-file-pair.js";

export type CopyResolution = WriteResolution | FilePairBlocked | {
  kind: "blocked"; reason: "unsupported-copy";
};

/** Potential destination writes only; a copy does not remove its source.
 * Interactive/no-clobber may skip the operation, but are not proof of no write.
 */
export async function resolveCopy(request: CopyRequest, cwd: string, repo: string): Promise<CopyResolution> {
  if (request.kind !== "copy" || !["default", "interactive", "no-clobber"].includes(request.overwrite)) {
    return { kind: "blocked", reason: "unsupported-copy" };
  }
  const pair = await resolveFilePair(request.source, request.destination, cwd, repo);
  return pair.kind === "blocked" ? pair : { kind: "resolved", writes: pair.destination };
}
