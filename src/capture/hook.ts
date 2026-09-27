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
  /**
   * What it runs, as a person would type it. The settings file gets this with
   * `session` spelled out as a launcher — see `commandLine`.
   */
  readonly command: string;
  /** Seconds allowed before the handler is cancelled. */
  readonly timeout: number;
  /** True for the hooks that only passive capture needs. */
  readonly passive: boolean;
  /** The tools a PreToolUse group fires for. Absent means every occurrence. */
  readonly matcher?: string;
}

/**
 * Closes the open session, whichever way the editor session ended — cleared,
 * logged out, or the window closed.
 *
 * `--if-open` because the hook fires for every Claude Code session, including
 * the ones where nobody ran `session start` and passive capture is off: with
 * nothing open for that repo there is nothing to close and nothing to say.
 *
 * `SessionEnd` handlers share a 1.5-second budget by default, which `session
 * stop` can outrun: it shells out to git and then reads the whole transcript
 * to count tokens. Past the budget the handler is cancelled and the session
 * stays open forever — the one failure that loses a record rather than merely
 * delaying it. A per-hook `timeout` raises the shared budget to match, up to
 * 60.
 *
 * Thirty, because closing the session is no longer all this does: once a day
 * per repo it also settles what has landed and runs the survival checks that
 * have come due, which is a `git log` per path — see `commands/sweep.ts`. The
 * stop is written first and the sweep second, so a budget that still runs out
 * costs a day of sweeping rather than a record. An installation left at the
 * old ten seconds keeps working for the same reason; `session hook install`
 * raises it, and `hasHook` reports the old entry as needing that repair.
 */
export const STOP_HOOK: HookSpec = {
  event: "SessionEnd",
  command: "session stop --if-open",
  timeout: 30,
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
 * Ten seconds, for the same reason `SessionEnd` needs its own budget — it
 * reads HEAD and the dirty files before it writes. Less than that hook needs,
 * because nothing sweeps here: this one is on the path between the developer
 * opening the editor and the agent starting.
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
 * Checks an attempted Edit, Write or MultiEdit against the open session's
 * agreement, before the tool runs.
 *
 * Deliberately not in `HOOKS`: those belong in the user's settings and fire
 * everywhere, and this one denies a supported write it cannot place in a
 * repository. It is registered per repository, opt-in, and nothing that
 * installs or removes `HOOKS` may touch it.
 *
 * The matcher names the tools the check reads — `parseClaudeWrite` for the
 * file tools, `parseClaudeBash` for shell commands — and no others. Adding a
 * tool here makes an existing install read as not registered, so a repeat
 * `--repo` install repairs it rather than leaving the old group in place.
 * Ten seconds, twice the check's own deadline (`CHECK_DEADLINE_MS`): the host
 * lets a timed-out PreToolUse hook through, so the check has to deny on its
 * own clock before the host's runs out. A process that cannot start at all, or
 * is killed, is still let through — no setting here can change that.
 */
export const CHECK_HOOK: HookSpec = {
  event: "PreToolUse",
  command: "session hook check",
  timeout: 10,
  passive: false,
  matcher: "Edit|Write|MultiEdit|Bash",
};

/**
 * The hooks an installation wants. With passive capture off that is the stop
 * hook alone — and the other two are then unwanted rather than merely absent,
 * so installing that way takes back out whatever an earlier install left.
 */
export function wantedHooks(passive: boolean): HookSpec[] {
  return HOOKS.filter((hook) => passive || !hook.passive);
}

/**
 * The node binary and this package's `cli.js`, by absolute path, which is
 * what a registered hook runs instead of a bare `session`.
 *
 * An editor runs a hook through `/bin/sh`, which reads none of the developer's
 * shell startup files. Whatever put `session` on their PATH — nvm, Volta, a
 * Homebrew prefix — is not there, so a bare `session` exits 127 and the
 * session it was meant to open or close is silently never recorded. Both
 * paths are spelled out rather than the `session` shim, because the shim is
 * `#!/usr/bin/env node` and that PATH may have no `node` either.
 *
 * Absolute paths go stale when node or the package moves; installing again
 * rewrites them.
 */
export interface Launcher {
  readonly node: string;
  readonly cli: string;
}

/** A word as `/bin/sh` reads it back: bare when that is safe, single-quoted when not. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The subcommand and flags a hook passes, without the program name. */
function argsOf(hook: HookSpec): string[] {
  return hook.command.split(" ").slice(1);
}

/** The command line registered for a hook: the launcher, then its arguments. */
export function commandLine(hook: HookSpec, launcher: Launcher): string {
  return [shellWord(launcher.node), shellWord(launcher.cli), ...argsOf(hook)].join(" ");
}

/** The launcher as it appears at the front of every registered command. */
export function launcherLine(launcher: Launcher): string {
  return `${shellWord(launcher.node)} ${shellWord(launcher.cli)}`;
}

/**
 * The words of a command line, for the two spellings `shellWord` writes: bare
 * words and single-quoted ones. Anything else — double quotes, a backslash,
 * an operator — is not a command this tool wrote, and reads as undefined.
 */
function wordsOf(command: string): string[] | undefined {
  const words: string[] = [];
  let word: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return undefined;
      word = (word ?? "") + command.slice(i + 1, end);
      i = end;
    } else if (char === "\\" && command[i + 1] === "'") {
      word = (word ?? "") + "'";
      i++;
    } else if (/[\w@%+=:,./-]/.test(char)) {
      word = (word ?? "") + char;
    } else {
      return undefined;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/**
 * True when a command line runs this hook, however `session` was spelled: bare
 * (every install before this one), an absolute path to a `session` shim (a
 * hand repair), or a node binary and a `cli.js` (this install, or an earlier
 * one whose paths have since moved). The arguments must match exactly, so a
 * hook somebody else wrote around `session` is not taken for ours.
 */
function runsHook(command: string, hook: HookSpec): boolean {
  const words = wordsOf(command);
  if (words === undefined) return false;
  const args = argsOf(hook);
  const head = words.slice(0, words.length - args.length);
  if (words.slice(head.length).join(" ") !== args.join(" ")) return false;
  if (head.length === 1) {
    return head[0] === "session" || (head[0]!.startsWith("/") && baseName(head[0]!) === "session");
  }
  return head.length === 2 && head.every((word) => word.startsWith("/")) && baseName(head[1]!) === "cli.js";
}

/**
 * How many registered commands, of any event and anybody's, start with a bare
 * `session` — which a hook's `/bin/sh` may not find.
 */
export function bareSessionCommands(settings: Settings): number {
  const hooks = settings["hooks"];
  if (!isObject(hooks)) return 0;
  let count = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group["hooks"])) continue;
      for (const entry of group["hooks"]) {
        if (isObject(entry) && typeof entry["command"] === "string" && /^\s*session(\s|$)/.test(entry["command"])) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * A matcher group. `SessionEnd` and `SessionStart` both support a `matcher` —
 * why the session ended, how it began — but the field is optional and an
 * omitted matcher means every occurrence. Every start and every ending is one
 * we want to record, so the key is deliberately absent rather than written as
 * `"*"`.
 */
function ourGroup(hook: HookSpec, launcher: Launcher): Record<string, unknown> {
  const entry = { type: "command", command: commandLine(hook, launcher), timeout: hook.timeout };
  return hook.matcher === undefined ? { hooks: [entry] } : { matcher: hook.matcher, hooks: [entry] };
}

/** A parsed settings file. Keys `session` knows nothing about are carried through. */
export type Settings = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntryFor(hook: HookSpec, entry: unknown): boolean {
  return isObject(entry) && typeof entry["command"] === "string" && runsHook(entry["command"], hook);
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
      `${what} in the settings file is not an object. ` +
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
      `hooks.${event} in the settings file is not a list. ` +
        `Fix it by hand, then run session hook install again.`,
    );
  }
  return value;
}

/**
 * Whether a group fires for exactly the tools the hook needs. A hook with no
 * matcher is indifferent to the group's; one with a matcher accepts only its
 * own, since a narrower group would let a supported tool through unchecked.
 */
function groupMatches(group: Record<string, unknown>, hook: HookSpec): boolean {
  return hook.matcher === undefined || group["matcher"] === hook.matcher;
}

interface Found {
  entry: Record<string, unknown>;
  matches: boolean;
}

/** Every registered entry running one hook's command, whatever else it says. */
function foundFor(settings: Settings, hook: HookSpec): Found[] {
  const found: Found[] = [];
  for (const group of groupsOf(settings, hook.event)) {
    if (!isObject(group) || !Array.isArray(group["hooks"])) {
      continue;
    }
    for (const entry of group["hooks"]) {
      if (isEntryFor(hook, entry)) {
        found.push({ entry: entry as Record<string, unknown>, matches: groupMatches(group, hook) });
      }
    }
  }
  return found;
}

function entriesFor(settings: Settings, hook: HookSpec): Record<string, unknown>[] {
  return foundFor(settings, hook).map((item) => item.entry);
}

/** True when any entry runs the hook's command, whatever its matcher or budget. */
export function hasEntry(settings: Settings, hook: HookSpec): boolean {
  return entriesFor(settings, hook).length > 0;
}

/**
 * True when one hook is registered and says what it should. An entry left by
 * an older `session` runs the right command on too short a budget, or through
 * a bare `session` or a launcher that has since moved, so it reads as not
 * registered: installing over it is a repair, not a no-op. So does one filed
 * under a matcher other than the hook's own.
 */
export function hasHook(settings: Settings, hook: HookSpec, launcher: Launcher): boolean {
  const found = foundFor(settings, hook);
  return found.length > 0 &&
    found.every((item) =>
      item.matches &&
      item.entry["timeout"] === hook.timeout &&
      item.entry["command"] === commandLine(hook, launcher));
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
export function hasHooks(settings: Settings, wanted: readonly HookSpec[], launcher: Launcher): boolean {
  return HOOKS.every((hook) =>
    wanted.includes(hook)
      ? hasHook(settings, hook, launcher)
      : entriesFor(settings, hook).length === 0,
  );
}

function addHook(settings: Settings, hook: HookSpec, launcher: Launcher): Settings {
  // An entry already running the command is corrected where it stands, so an
  // upgrade never leaves two hooks racing to do the same thing. One under the
  // wrong matcher cannot be corrected where it stands without changing what
  // the rest of that group fires for, so it is taken out and filed afresh.
  const found = foundFor(settings, hook);
  if (found.some((item) => !item.matches)) {
    settings = removeHook(settings, hook);
  } else if (found.length > 0) {
    for (const { entry } of found) {
      entry["command"] = commandLine(hook, launcher);
      entry["timeout"] = hook.timeout;
    }
    return settings;
  }

  const hooks = claim(settings["hooks"], "hooks") ?? {};
  const groups = claimGroups(hooks[hook.event], hook.event) ?? [];

  groups.push(ourGroup(hook, launcher));
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

  const kept = groups.filter((group) => keepsAnything(group, hook));

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
 * Takes our entries out of one group, in place, and says whether anything is
 * left in it. A group that is not the shape we write is left alone.
 */
function keepsAnything(group: unknown, hook: HookSpec): boolean {
  if (!isObject(group) || !Array.isArray(group["hooks"])) {
    return true; // not a shape we put there; leave it alone
  }
  const entries: unknown[] = group["hooks"].filter((entry) => !isEntryFor(hook, entry));
  group["hooks"] = entries;
  return entries.length > 0;
}

/**
 * The settings with exactly `wanted` registered, alongside whatever else was
 * already there. Hooks of ours that `wanted` leaves out are taken back out, so
 * this is the whole arrangement rather than an addition to it. Installing
 * twice registers each of them once.
 */
export function withHooks(settings: Settings, wanted: readonly HookSpec[], launcher: Launcher): Settings {
  let next = structuredClone(settings);
  for (const hook of HOOKS) {
    next = wanted.includes(hook) ? addHook(next, hook, launcher) : removeHook(next, hook);
  }
  return next;
}

/**
 * The settings with one hook registered, alongside whatever else was there.
 * For a hook kept apart from `HOOKS` — the check — so adding it says nothing
 * about the others, and adding it twice registers it once.
 */
export function withHook(settings: Settings, hook: HookSpec, launcher: Launcher): Settings {
  return addHook(structuredClone(settings), hook, launcher);
}

/** The settings with one hook taken out and nothing else touched. */
export function withoutHook(settings: Settings, hook: HookSpec): Settings {
  return removeHook(structuredClone(settings), hook);
}

/** The settings with every hook of ours taken out and nothing else touched. */
export function withoutHooks(settings: Settings): Settings {
  let next = structuredClone(settings);
  for (const hook of HOOKS) {
    next = removeHook(next, hook);
  }
  return next;
}
