import type { Session } from "./store/record.js";

export class WriteSessionSelectionError extends Error {
  constructor(reason: "unbound" | "ambiguous") {
    super(reason === "unbound"
      ? "Open agreement has no checkout binding. Close it and start a new session in the intended checkout."
      : "Multiple sessions are open in this checkout. Close the extra sessions before retrying.");
  }
}

/** Selection for enforcement only; historical views keep repository-level history. */
export function selectWriteSession(sessions: readonly Session[], checkout: string): Session | undefined {
  const open = sessions.filter((session) => session.endedAt === null);
  // A legacy agreement could belong here. Ignoring it would silently bypass
  // its policy, while choosing it would invent a checkout binding.
  if (open.some((session) => session.agreement !== undefined &&
    (typeof session.checkout !== "string" || session.checkout === ""))) {
    throw new WriteSessionSelectionError("unbound");
  }
  const local = open.filter((session) => session.checkout === checkout);
  if (local.length > 1) {
    throw new WriteSessionSelectionError("ambiguous");
  }
  return local[0];
}
