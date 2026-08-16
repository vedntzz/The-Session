/**
 * The Claude Code event that fires when a session ends, whichever way it ended
 * — cleared, logged out, or the window closed.
 */
export const HOOK_EVENT = "SessionEnd";

/**
 * What the hook runs. `--if-open` because the hook fires on every Claude Code
 * session, including the ones where nobody ran `session start`: with nothing
 * open for that repo there is nothing to close and nothing to say about it.
 */
export const HOOK_COMMAND = "session stop --if-open";

/**
 * Seconds allowed for the command. `SessionEnd` handlers share a 1.5-second
 * budget by default, which `session stop` can outrun: it shells out to git and
 * then reads the whole transcript to count tokens. Past the budget the handler
 * is cancelled and the session stays open forever — the one failure that loses
 * a record rather than merely delaying it. A per-hook `timeout` raises the
 * shared budget to match, up to 60.
 */
export const HOOK_TIMEOUT = 10;

/**
 * A matcher group. `SessionEnd` does support a `matcher` — it filters on why
 * the session ended (`clear`, `logout`, `prompt_input_exit`, and so on) — but
 * the field is optional and an omitted matcher means every occurrence. Every
 * ending is one we want to record, so the key is deliberately absent rather
 * than written as `"*"`.
 */
function ourGroup(): Record<string, unknown> {
  return { hooks: [{ type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT }] };
}

/** A parsed settings file. Keys `session` knows nothing about are carried through. */
export type Settings = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOurEntry(entry: unknown): boolean {
  return isObject(entry) && entry["command"] === HOOK_COMMAND;
}

/** The registered `SessionEnd` groups, or none when the file has no hooks. */
function groupsOf(settings: Settings): unknown[] {
  const hooks = settings["hooks"];
  if (!isObject(hooks)) {
    return [];
  }
  const groups = hooks[HOOK_EVENT];
  return Array.isArray(groups) ? groups : [];
}

/**
 * Refuses to work around a shape that is not what it claims to be. Someone
 * else's settings file is the last place to guess: better to say what is wrong
 * than to overwrite an editor's configuration with our idea of it.
 */
function claim(value: unknown, what: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(
      `${what} in the Claude Code settings file is not an object. ` +
        `Fix it by hand, then run session hook install again.`,
    );
  }
  return value;
}

function claimGroups(value: unknown): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `hooks.${HOOK_EVENT} in the Claude Code settings file is not a list. ` +
        `Fix it by hand, then run session hook install again.`,
    );
  }
  return value;
}

/** Every registered entry running our command, whatever else it says. */
function ourEntries(settings: Settings): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const group of groupsOf(settings)) {
    if (!isObject(group) || !Array.isArray(group["hooks"])) {
      continue;
    }
    for (const entry of group["hooks"]) {
      if (isOurEntry(entry)) {
        found.push(entry as Record<string, unknown>);
      }
    }
  }
  return found;
}

/**
 * True when the hook is registered and says what it should. An entry left by
 * an older `session` runs the right command on too short a budget, so it reads
 * as not registered: installing over it is a repair, not a no-op.
 */
export function hasHook(settings: Settings): boolean {
  const entries = ourEntries(settings);
  return entries.length > 0 && entries.every((entry) => entry["timeout"] === HOOK_TIMEOUT);
}

/**
 * The settings with the hook registered, alongside whatever was already there.
 * Installing twice registers it once.
 */
export function withHook(settings: Settings): Settings {
  const next = structuredClone(settings);

  // An entry already running the command is corrected where it stands, so an
  // upgrade never leaves two hooks racing to close the same session.
  const existing = ourEntries(next);
  if (existing.length > 0) {
    for (const entry of existing) {
      entry["timeout"] = HOOK_TIMEOUT;
    }
    return next;
  }

  const hooks = claim(next["hooks"], "hooks") ?? {};
  const groups = claimGroups(hooks[HOOK_EVENT]) ?? [];

  groups.push(ourGroup());
  hooks[HOOK_EVENT] = groups;
  next["hooks"] = hooks;
  return next;
}

/**
 * The settings with the hook taken out and nothing else touched. Containers
 * that only existed to hold it are pruned, so uninstalling returns the file to
 * roughly the shape installing found it in.
 */
export function withoutHook(settings: Settings): Settings {
  const next = structuredClone(settings);
  const hooks = claim(next["hooks"], "hooks");
  if (!hooks) {
    return next;
  }
  const groups = claimGroups(hooks[HOOK_EVENT]);
  if (!groups) {
    return next;
  }

  const kept = groups.filter((group) => {
    if (!isObject(group) || !Array.isArray(group["hooks"])) {
      return true; // not a shape we put there; leave it alone
    }
    const entries: unknown[] = group["hooks"].filter((entry) => !isOurEntry(entry));
    group["hooks"] = entries;
    return entries.length > 0;
  });

  if (kept.length > 0) {
    hooks[HOOK_EVENT] = kept;
  } else {
    delete hooks[HOOK_EVENT];
  }
  if (Object.keys(hooks).length > 0) {
    next["hooks"] = hooks;
  } else {
    delete next["hooks"];
  }
  return next;
}
