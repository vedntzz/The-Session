/**
 * The Claude Code hooks `session hook install` registers, and the surgery on
 * somebody else's settings file that registers them.
 *
 * Two arrangements, and the developer picks:
 *
 * - The manual flow is one hook. `session start` declares the intent and the
 *   scope; `SessionEnd` closes whatever is open.
 * - Passive capture is three. `SessionStart` opens a session for a repo that
 *   has none, `UserPromptSubmit` writes the first prompt into it as its
 *   intent, and `SessionEnd` closes it as before. Nothing is declared, so
 *   nothing is compared against a declaration — see `Session.intentSource`.
 *
 * Everything these hooks run is silent on success. `SessionStart` and
 * `UserPromptSubmit` handlers have their stdout fed to the agent as context,
 * so a line printed here would end up inside somebody's prompt; and a
 * `UserPromptSubmit` handler that exits non-zero blocks the prompt outright.
 * A recorder that can delete a developer's prompt is worse than no recorder,
 * which is why the commands behind these two say nothing and fail at nothing.
 */

/** One registered hook: the event, what it runs, and how long it may take. */
export interface HookSpec {
  /** The Claude Code event that fires it. */
  readonly event: string;
  /** The command line registered against that event. */
  readonly command: string;
  /** Seconds allowed before the handler is cancelled. */
  readonly timeout: number;
  /** True for the hooks that only passive capture needs. */
  readonly passive: boolean;
}

/**
 * Closes the open session, whichever way the editor session ended — cleared,
 * logged out, or the window closed.
 *
 * `--if-open` because the hook fires for every Claude Code session, including
 * the ones where nobody ran `session start` and passive capture is off: with
 * nothing open for that repo there is nothing to close and nothing to say.
 *
 * Ten seconds because `SessionEnd` handlers share a 1.5-second budget by
 * default, which `session stop` can outrun: it shells out to git and then
 * reads the whole transcript to count tokens. Past the budget the handler is
 * cancelled and the session stays open forever — the one failure that loses a
 * record rather than merely delaying it. A per-hook `timeout` raises the
 * shared budget to match, up to 60.
 */
export const STOP_HOOK: HookSpec = {
  event: "SessionEnd",
  command: "session stop --if-open",
  timeout: 10,
  passive: false,
};

/**
 * Opens a session for a repo that has none, so that work nobody declared is
 * still recorded.
 *
 * `--passive` is what makes it defer: a session the developer opened
 * themselves is left exactly as it is, because they declared an intent and a
 * scope and a second session would take the diff away from it.
 *
 * The same ten seconds as `SessionEnd`, and for the same reason — it reads
 * HEAD and the dirty files before it writes.
 */
export const OPEN_HOOK: HookSpec = {
  event: "SessionStart",
  command: "session start --passive",
  timeout: 10,
  passive: true,
};

/**
 * Writes the first prompt of a passive session into it as its intent.
 *
 * Registered against every prompt because only the first one can be known to
 * be the first. Every later prompt finds an intent already written and stops
 * there, which is a log read and nothing else.
 *
 * Five seconds, and it will not use them: this is on the path between a
 * developer pressing enter and the agent starting, and the work is a read of
 * one file and at most one appended line.
 */
export const PROMPT_HOOK: HookSpec = {
  event: "UserPromptSubmit",
  command: "session intent --from-prompt",
  timeout: 5,
  passive: true,
};

/** Every hook this tool knows how to register. */
export const HOOKS: readonly HookSpec[] = [STOP_HOOK, OPEN_HOOK, PROMPT_HOOK];

/**
 * The hooks an installation wants. With passive capture off that is the stop
 * hook alone — and the other two are then unwanted rather than merely absent,
 * so installing that way takes back out whatever an earlier install left.
 */
export function wantedHooks(passive: boolean): HookSpec[] {
  return HOOKS.filter((hook) => passive || !hook.passive);
}

/**
 * A matcher group. `SessionEnd` and `SessionStart` both support a `matcher` —
 * why the session ended, how it began — but the field is optional and an
 * omitted matcher means every occurrence. Every start and every ending is one
 * we want to record, so the key is deliberately absent rather than written as
 * `"*"`.
 */
function ourGroup(hook: HookSpec): Record<string, unknown> {
  return { hooks: [{ type: "command", command: hook.command, timeout: hook.timeout }] };
}

/** A parsed settings file. Keys `session` knows nothing about are carried through. */
export type Settings = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntryFor(hook: HookSpec, entry: unknown): boolean {
  return isObject(entry) && entry["command"] === hook.command;
}

/** The groups registered against an event, or none when the file has none. */
function groupsOf(settings: Settings, event: string): unknown[] {
  const hooks = settings["hooks"];
  if (!isObject(hooks)) {
    return [];
  }
  const groups = hooks[event];
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

function claimGroups(value: unknown, event: string): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `hooks.${event} in the Claude Code settings file is not a list. ` +
        `Fix it by hand, then run session hook install again.`,
    );
  }
  return value;
}

/** Every registered entry running one hook's command, whatever else it says. */
function entriesFor(settings: Settings, hook: HookSpec): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const group of groupsOf(settings, hook.event)) {
    if (!isObject(group) || !Array.isArray(group["hooks"])) {
      continue;
    }
    for (const entry of group["hooks"]) {
      if (isEntryFor(hook, entry)) {
        found.push(entry as Record<string, unknown>);
      }
    }
  }
  return found;
}

/**
 * True when one hook is registered and says what it should. An entry left by
 * an older `session` runs the right command on too short a budget, so it reads
 * as not registered: installing over it is a repair, not a no-op.
 */
export function hasHook(settings: Settings, hook: HookSpec): boolean {
  const entries = entriesFor(settings, hook);
  return entries.length > 0 && entries.every((entry) => entry["timeout"] === hook.timeout);
}

/**
 * True when the settings say exactly what `wanted` asks for: every hook in it
 * registered, and every other hook of ours absent.
 *
 * Both halves, because the two arrangements are a choice rather than a
 * cumulative set. Installing without passive capture over an installation that
 * had it is a change — the settings file still holds two hooks that would open
 * sessions nobody asked for, and reporting "already" would leave them there.
 */
export function hasHooks(settings: Settings, wanted: readonly HookSpec[]): boolean {
  return HOOKS.every((hook) =>
    wanted.includes(hook)
      ? hasHook(settings, hook)
      : entriesFor(settings, hook).length === 0,
  );
}

function addHook(settings: Settings, hook: HookSpec): Settings {
  // An entry already running the command is corrected where it stands, so an
  // upgrade never leaves two hooks racing to do the same thing.
  const existing = entriesFor(settings, hook);
  if (existing.length > 0) {
    for (const entry of existing) {
      entry["timeout"] = hook.timeout;
    }
    return settings;
  }

  const hooks = claim(settings["hooks"], "hooks") ?? {};
  const groups = claimGroups(hooks[hook.event], hook.event) ?? [];

  groups.push(ourGroup(hook));
  hooks[hook.event] = groups;
  settings["hooks"] = hooks;
  return settings;
}

/**
 * Takes one hook out and touches nothing else. Containers that only existed to
 * hold it are pruned, so uninstalling returns the file to roughly the shape
 * installing found it in.
 */
function removeHook(settings: Settings, hook: HookSpec): Settings {
  const hooks = claim(settings["hooks"], "hooks");
  if (!hooks) {
    return settings;
  }
  const groups = claimGroups(hooks[hook.event], hook.event);
  if (!groups) {
    return settings;
  }

  const kept = groups.filter((group) => {
    if (!isObject(group) || !Array.isArray(group["hooks"])) {
      return true; // not a shape we put there; leave it alone
    }
    const entries: unknown[] = group["hooks"].filter((entry) => !isEntryFor(hook, entry));
    group["hooks"] = entries;
    return entries.length > 0;
  });

  if (kept.length > 0) {
    hooks[hook.event] = kept;
  } else {
    delete hooks[hook.event];
  }
  if (Object.keys(hooks).length > 0) {
    settings["hooks"] = hooks;
  } else {
    delete settings["hooks"];
  }
  return settings;
}

/**
 * The settings with exactly `wanted` registered, alongside whatever else was
 * already there. Hooks of ours that `wanted` leaves out are taken back out, so
 * this is the whole arrangement rather than an addition to it. Installing
 * twice registers each of them once.
 */
export function withHooks(settings: Settings, wanted: readonly HookSpec[]): Settings {
  let next = structuredClone(settings);
  for (const hook of HOOKS) {
    next = wanted.includes(hook) ? addHook(next, hook) : removeHook(next, hook);
  }
  return next;
}

/** The settings with every hook of ours taken out and nothing else touched. */
export function withoutHooks(settings: Settings): Settings {
  let next = structuredClone(settings);
  for (const hook of HOOKS) {
    next = removeHook(next, hook);
  }
  return next;
}
