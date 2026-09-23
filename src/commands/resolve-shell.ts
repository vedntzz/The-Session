// One shell command to the writes the agreement is checked against, or to
// "can't tell". Every recognizer in shell/ is asked; exactly one must claim the
// command. Metadata-only filesystem reads, through the same resolvers the
// Edit/Write check uses. Not a sandbox: see docs/agreements.md.
import type { AgreementWrite } from "../agreement-decision.js";
import { parseCopy } from "../shell/copy.js";
import { parseMove } from "../shell/move.js";
import { packageManagerWrites, type ShellWrites } from "../shell/package-manager.js";
import { readOnlyWrites } from "../shell/read-only.js";
import { redirectWrites } from "../shell/redirect.js";
import { parseRemove } from "../shell/remove.js";
import { sedWrites, type SedDialect } from "../shell/sed.js";
import { teeWrites } from "../shell/tee.js";
import { resolveCopy } from "./resolve-copy.js";
import { resolveMove } from "./resolve-move.js";
import { resolveRemove } from "./resolve-remove.js";
import { resolveFileWrite } from "./resolve-write.js";

export type ShellResolution =
  /** What the command writes among tracked files; empty for a known reader. */
  | { kind: "resolved"; writes: readonly AgreementWrite[] }
  /** No recognizer, or more than one, claims it: can't tell what it writes. */
  | { kind: "unknown" }
  /** Recognized, but a path could not be checked; never read as no writes. */
  | { kind: "blocked"; reason: string };

/** macOS ships BSD sed; elsewhere assume GNU. A sed earlier on PATH is the
 * stated PATH limit, not something the command text can show. */
export function platformSedDialect(platform: NodeJS.Platform = process.platform): SedDialect {
  return platform === "darwin" ? "macos" : "gnu";
}

type Claim = () => Promise<ShellResolution>;

/**
 * Exactly one recognizer must claim a command. None is "can't tell"; two
 * would be two readings of one command, and picking either would be a guess.
 */
export async function resolveShellCommand(
  command: string, cwd: string, repo: string, dialect: SedDialect = platformSedDialect(),
): Promise<ShellResolution> {
  const claims: Claim[] = [];
  for (const writes of [
    readOnlyWrites(command), packageManagerWrites(command), sedWrites(command, dialect),
    redirectWrites(command), teeWrites(command),
  ]) {
    if (writes.kind === "writes") claims.push(() => resolvePaths(writes, cwd, repo));
  }
  const move = parseMove(command);
  if (move.kind === "move") claims.push(() => resolveMove(move, cwd, repo));
  const copy = parseCopy(command);
  if (copy.kind === "copy") claims.push(() => resolveCopy(copy, cwd, repo));
  const remove = parseRemove(command);
  if (remove.kind === "remove") claims.push(() => resolveRemove(remove, cwd, repo));

  if (claims.length !== 1) return { kind: "unknown" };
  return claims[0]!();
}

/** Paths a recognizer names, relative to the command's directory, resolved as
 * the Edit/Write check resolves them. One blocked path blocks the command. */
async function resolvePaths(writes: Extract<ShellWrites, { kind: "writes" }>, cwd: string, repo: string): Promise<ShellResolution> {
  const found = new Map<string, AgreementWrite>();
  for (const filePath of writes.paths) {
    const resolved = await resolveFileWrite({ cwd, filePath }, repo);
    if (resolved.kind === "blocked") return resolved;
    for (const write of resolved.writes) found.set(write.path, write);
  }
  return { kind: "resolved", writes: [...found.values()] };
}
