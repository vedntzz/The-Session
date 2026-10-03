import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGit } from "../src/git.js";
import { buildProgram } from "../src/program.js";
import {
  bareSessionCommands,
  CHECK_HOOK,
  commandLine,
  hasEntry,
  hasHook,
  hasHooks,
  HOOKS,
  OPEN_HOOK,
  PROMPT_HOOK,
  STOP_HOOK,
  wantedHooks,
  withHook,
  withHooks,
  withoutHook,
  withoutHooks,
  type HookSpec,
  type Launcher,
  type Settings,
} from "../src/capture/hook.js";
import {
  codexHooksFile,
  currentLauncher,
  repoSettingsFile,
  formatHook,
  installCodexHooks,
  installRepoHooks,
  installHook,
  uninstallCodexHooks,
  uninstallRepoHooks,
  settingsFile,
  uninstallHook,
  type HookResult,
} from "../src/commands/hook.js";

/** Where these tests say node and the CLI live. */
const L: Launcher = { node: "/usr/local/bin/node", cli: "/opt/session/dist/cli.js" };

/** The group `withHooks` writes for one hook, as it appears in a settings file. */
function group(hook: HookSpec): Record<string, unknown> {
  return { hooks: [{ type: "command", command: commandLine(hook, L), timeout: hook.timeout }] };
}

const STOP = group(STOP_HOOK);
const OPEN = group(OPEN_HOOK);
const PROMPT = group(PROMPT_HOOK);

/** The group a `session` from before the timeout wrote. */
const STALE = { hooks: [{ type: "command", command: STOP_HOOK.command }] };
/** Somebody else's SessionEnd hook, which must survive every operation. */
const THEIRS = { hooks: [{ type: "command", command: "say goodbye" }] };

/** What a settings file holds after a full install. */
const ALL: Settings = { hooks: { [STOP_HOOK.event]: [STOP], [OPEN_HOOK.event]: [OPEN], [PROMPT_HOOK.event]: [PROMPT] } };
/** `ALL` as an installer writes it: the start hook names its own tool, so a start can say which agent opened it. */
const installed = (agent: string): Settings => ({ hooks: { ...(ALL["hooks"] as object), [OPEN_HOOK.event]:
  [{ hooks: [{ type: "command", command: commandLine(OPEN_HOOK, L, agent), timeout: OPEN_HOOK.timeout }] }] } });

/** What it holds when passive capture was turned off. */
const MANUAL: Settings = { hooks: { [STOP_HOOK.event]: [STOP] } };

describe("the hooks it registers", () => {
  it("closes an open session on SessionEnd, and stays quiet when there is none", () => {
    // The hook fires for every Claude Code session, declared or not.
    expect(STOP_HOOK.event).toBe("SessionEnd");
    expect(STOP_HOOK.command).toBe("session stop --if-open");
  });

  it("opens an undeclared session on SessionStart", () => {
    expect(OPEN_HOOK.event).toBe("SessionStart");
    expect(OPEN_HOOK.command).toBe("session start --passive");
  });

  it("writes the first prompt into it on UserPromptSubmit", () => {
    // Every prompt, because only the first one can be known to be the first.
    expect(PROMPT_HOOK.event).toBe("UserPromptSubmit");
    expect(PROMPT_HOOK.command).toBe("session intent --from-prompt");
  });

  it("counts the two that passive capture needs as passive, and the closer as not", () => {
    expect(STOP_HOOK.passive).toBe(false);
    expect(OPEN_HOOK.passive).toBe(true);
    expect(PROMPT_HOOK.passive).toBe(true);
  });

  it("asks for longer than the 1.5 seconds a handler gets by default", () => {
    // git plus the whole transcript does not reliably fit in the default
    // budget, and a cancelled SessionEnd leaves the session open forever.
    for (const hook of HOOKS) {
      expect(hook.timeout).toBeGreaterThan(1.5);
      // Claude Code raises the shared budget to match, but only up to 60.
      expect(hook.timeout).toBeLessThanOrEqual(60);
    }
  });

  it("gives the prompt hook the shortest budget of the three", () => {
    // It sits between a keystroke and the agent starting, and does a read and
    // at most one appended line.
    expect(PROMPT_HOOK.timeout).toBeLessThan(STOP_HOOK.timeout);
  });

  it("registers no matcher, so every start and every ending is recorded", () => {
    // Both events match on a reason — why the session ended, how it began —
    // and omitting the key means all of them. A `/clear` is as much an ending
    // as closing the window.
    const hooks = withHooks({}, HOOKS, L)["hooks"] as Record<string, unknown>;

    for (const hook of HOOKS) {
      const groups = hooks[hook.event] as Record<string, unknown>[];
      expect(groups).toHaveLength(1);
      expect("matcher" in (groups[0] as Record<string, unknown>)).toBe(false);
    }
  });

  it("nests each handler inside a matcher group, as the settings schema wants", () => {
    expect(withHooks({}, HOOKS, L)).toEqual(ALL);
  });
});

describe("wantedHooks", () => {
  it("is all three when passive capture is on", () => {
    expect(wantedHooks(true)).toEqual([STOP_HOOK, OPEN_HOOK, PROMPT_HOOK]);
  });

  it("is the closer alone when it is off", () => {
    // The manual flow: `session start` opens every session there is.
    expect(wantedHooks(false)).toEqual([STOP_HOOK]);
  });
});

describe("hasHooks", () => {
  it("finds them once they are registered", () => {
    expect(hasHooks(ALL, HOOKS, L)).toBe(true);
  });

  it("is false for settings with no hooks at all", () => {
    expect(hasHooks({}, HOOKS, L)).toBe(false);
    expect(hasHooks({ model: "opus" }, HOOKS, L)).toBe(false);
  });

  it("is false when only some of them are registered", () => {
    expect(hasHooks(MANUAL, HOOKS, L)).toBe(false);
  });

  it("is false when a passive hook is registered and passive capture was not asked for", () => {
    // Otherwise `--passive=false` over a passive install would report
    // "already" and leave two hooks opening sessions nobody asked for.
    expect(hasHooks(ALL, wantedHooks(false), L)).toBe(false);
  });

  it("is true for the closer alone when that is all that was asked for", () => {
    expect(hasHooks(MANUAL, wantedHooks(false), L)).toBe(true);
  });

  it("is true for settings with none of them when none were asked for", () => {
    expect(hasHooks({ model: "opus" }, [], L)).toBe(true);
  });

  it("is false when someone else's hook is the only one there", () => {
    expect(hasHooks({ hooks: { [STOP_HOOK.event]: [THEIRS] } }, wantedHooks(false), L)).toBe(false);
  });

  it("is false when a hook is registered against the wrong event", () => {
    expect(hasHooks({ hooks: { PreToolUse: [STOP] } }, wantedHooks(false), L)).toBe(false);
  });

  it("is false for an entry left by a session that wrote no timeout", () => {
    expect(hasHooks({ hooks: { [STOP_HOOK.event]: [STALE] } }, wantedHooks(false), L)).toBe(false);
  });

  it("reads a malformed hooks section as no hooks, rather than throwing", () => {
    expect(hasHooks({ hooks: "nonsense" }, HOOKS, L)).toBe(false);
    expect(hasHooks({ hooks: { [STOP_HOOK.event]: "nonsense" } }, HOOKS, L)).toBe(false);
  });

  it("asks the same question of one hook as hasHook does", () => {
    expect(hasHook(MANUAL, STOP_HOOK, L)).toBe(true);
    expect(hasHook(MANUAL, OPEN_HOOK, L)).toBe(false);
  });
});

describe("withHooks", () => {
  it("registers them in settings that had none", () => {
    expect(withHooks({}, HOOKS, L)).toEqual(ALL);
  });

  it("registers the closer alone when that is what was asked for", () => {
    expect(withHooks({}, wantedHooks(false), L)).toEqual(MANUAL);
  });

  it("takes the passive hooks back out when they are no longer wanted", () => {
    // Turning capture off is a statement about the file, not an omission from
    // it: a flag that could not be changed its mind about would be a trap.
    expect(withHooks(ALL, wantedHooks(false), L)).toEqual(MANUAL);
  });

  it("adds the passive hooks to an installation that had only the closer", () => {
    expect(withHooks(MANUAL, HOOKS, L)).toEqual(ALL);
  });

  it("repairs an entry that was registered without a timeout", () => {
    expect(withHooks({ hooks: { [STOP_HOOK.event]: [STALE] } }, wantedHooks(false), L)).toEqual(
      MANUAL,
    );
  });

  it("repairs that entry in place rather than adding a second one", () => {
    const next = withHooks({ hooks: { [STOP_HOOK.event]: [THEIRS, STALE] } }, wantedHooks(false), L);

    // Two hooks both closing the session would double-count the work.
    expect(next).toEqual({ hooks: { [STOP_HOOK.event]: [THEIRS, STOP] } });
  });

  it("registers each of them once, however many times it is asked", () => {
    const once = withHooks({}, HOOKS, L);
    expect(withHooks(once, HOOKS, L)).toEqual(once);
    expect(withHooks(withHooks(once, HOOKS, L), HOOKS, L)).toEqual(once);
  });

  it("leaves every other setting alone", () => {
    const settings: Settings = { model: "opus", theme: "dark", tui: { compact: true } };
    const next = withHooks(settings, HOOKS, L);

    expect(next["model"]).toBe("opus");
    expect(next["theme"]).toBe("dark");
    expect(next["tui"]).toEqual({ compact: true });
  });

  it("keeps other hooks on the same event, and adds itself after them", () => {
    const next = withHooks({ hooks: { [STOP_HOOK.event]: [THEIRS] } }, wantedHooks(false), L);

    expect(next).toEqual({ hooks: { [STOP_HOOK.event]: [THEIRS, STOP] } });
  });

  it("keeps hooks registered on events it knows nothing about", () => {
    const next = withHooks({ hooks: { PreToolUse: [THEIRS] } }, wantedHooks(false), L);

    expect(next).toEqual({ hooks: { PreToolUse: [THEIRS], [STOP_HOOK.event]: [STOP] } });
  });

  it("keeps somebody else's SessionStart hook when it takes its own back out", () => {
    const theirs = { hooks: { [OPEN_HOOK.event]: [THEIRS, OPEN] } };

    expect(withHooks(theirs, [], L)).toEqual({ hooks: { [OPEN_HOOK.event]: [THEIRS] } });
  });

  it("does not touch what it was given", () => {
    const settings: Settings = { hooks: { [STOP_HOOK.event]: [THEIRS] } };
    const before = structuredClone(settings);

    withHooks(settings, HOOKS, L);

    expect(settings).toEqual(before);
  });

  it("refuses to overwrite a hooks section that is not an object", () => {
    expect(() => withHooks({ hooks: "nonsense" }, HOOKS, L)).toThrow(/is not an object/);
  });

  it("refuses to overwrite a SessionEnd section that is not a list", () => {
    expect(() => withHooks({ hooks: { [STOP_HOOK.event]: { nope: true } } }, HOOKS, L)).toThrow(
      /is not a list/,
    );
  });

  it("names the event it refused, so a settings file can be fixed by hand", () => {
    expect(() => withHooks({ hooks: { [PROMPT_HOOK.event]: 7 } }, HOOKS, L)).toThrow(
      /hooks\.UserPromptSubmit/,
    );
  });
});

describe("withoutHooks", () => {
  it("takes all three back out", () => {
    expect(withoutHooks(withHooks({}, HOOKS, L))).toEqual({});
  });

  it("prunes the containers it created, and nothing more", () => {
    const next = withoutHooks(withHooks({ model: "opus" }, HOOKS, L));

    expect(next).toEqual({ model: "opus" });
    expect("hooks" in next).toBe(false);
  });

  it("leaves other hooks on those events registered", () => {
    const next = withoutHooks({ hooks: { [STOP_HOOK.event]: [THEIRS, STOP] } });

    expect(next).toEqual({ hooks: { [STOP_HOOK.event]: [THEIRS] } });
  });

  it("leaves other events registered", () => {
    const next = withoutHooks({ hooks: { PreToolUse: [THEIRS], [STOP_HOOK.event]: [STOP] } });

    expect(next).toEqual({ hooks: { PreToolUse: [THEIRS] } });
  });

  it("takes only its own entry out of a group it shares", () => {
    const shared = {
      hooks: [
        { type: "command", command: "say goodbye" },
        { type: "command", command: STOP_HOOK.command },
      ],
    };

    expect(withoutHooks({ hooks: { [STOP_HOOK.event]: [shared] } })).toEqual({
      hooks: { [STOP_HOOK.event]: [{ hooks: [{ type: "command", command: "say goodbye" }] }] },
    });
  });

  it("is a no-op on settings that never had them", () => {
    expect(withoutHooks({ model: "opus" })).toEqual({ model: "opus" });
    expect(withoutHooks({})).toEqual({});
  });

  it("does not touch what it was given", () => {
    const settings: Settings = { hooks: { [STOP_HOOK.event]: [STOP] } };
    const before = structuredClone(settings);

    withoutHooks(settings);

    expect(settings).toEqual(before);
  });
});

describe("the check hook", () => {
  const CHECK = {
    matcher: CHECK_HOOK.matcher,
    hooks: [{ type: "command", command: commandLine(CHECK_HOOK, L), timeout: CHECK_HOOK.timeout }],
  };
  /** Somebody else's PreToolUse hook, which must survive every operation. */
  const LINT = { matcher: "Write", hooks: [{ type: "command", command: "lint --staged" }] };

  it("runs the check before the file tools and shell commands, and nothing else", () => {
    expect(CHECK_HOOK.event).toBe("PreToolUse");
    expect(CHECK_HOOK.command).toBe("session hook check");
    expect(CHECK_HOOK.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit|Bash");
  });

  it("is never part of what the user-level install registers or removes", () => {
    expect(HOOKS).not.toContain(CHECK_HOOK);
    expect(wantedHooks(true)).not.toContain(CHECK_HOOK);
    const settings = { hooks: { PreToolUse: [CHECK] } };
    expect(withHooks(settings, wantedHooks(true), L).hooks).toMatchObject({ PreToolUse: [CHECK] });
    expect(withoutHooks(settings)).toEqual(settings);
  });

  it("files itself under its own matcher, beside everything else", () => {
    const before: Settings = { model: "opus", hooks: { PreToolUse: [LINT], [STOP_HOOK.event]: [STOP] } };
    const after = withHook(before, CHECK_HOOK, L);
    expect(after).toEqual({
      model: "opus",
      hooks: { PreToolUse: [LINT, CHECK], [STOP_HOOK.event]: [STOP] },
    });
    expect(hasHook(after, CHECK_HOOK, L)).toBe(true);
  });

  it("does not change the settings it was given", () => {
    const before: Settings = { hooks: { PreToolUse: [LINT] } };
    const copy = structuredClone(before);
    withHook(before, CHECK_HOOK, L);
    expect(before).toEqual(copy);
  });

  it("registers once, however many times it is added", () => {
    const twice = withHook(withHook({}, CHECK_HOOK, L), CHECK_HOOK, L);
    expect(twice).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("is not registered under another matcher, and is moved rather than duplicated", () => {
    // A group narrower than the hook's own would let Edit through unchecked.
    const narrow = {
      matcher: "Write",
      hooks: [{ type: "command", command: "lint --staged" }, CHECK.hooks[0]],
    };
    const settings: Settings = { hooks: { PreToolUse: [narrow] } };
    expect(hasHook(settings, CHECK_HOOK, L)).toBe(false);
    expect(withHook(settings, CHECK_HOOK, L)).toEqual({ hooks: { PreToolUse: [LINT, CHECK] } });
  });

  it("treats an install from before shell commands were checked as needing repair", () => {
    const before = { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: CHECK_HOOK.command, timeout: CHECK_HOOK.timeout }] };
    const settings: Settings = { hooks: { PreToolUse: [before] } };
    expect(hasHook(settings, CHECK_HOOK, L)).toBe(false);
    expect(withHook(settings, CHECK_HOOK, L)).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("repairs an entry on the wrong budget where it stands", () => {
    const stale = { matcher: CHECK_HOOK.matcher, hooks: [{ type: "command", command: CHECK_HOOK.command }] };
    const settings: Settings = { hooks: { PreToolUse: [stale] } };
    expect(hasHook(settings, CHECK_HOOK, L)).toBe(false);
    expect(withHook(settings, CHECK_HOOK, L)).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("comes back out alone, pruning only what it emptied", () => {
    const installed = withHook({ model: "opus", hooks: { PreToolUse: [LINT] } }, CHECK_HOOK, L);
    expect(withoutHook(installed, CHECK_HOOK)).toEqual({ model: "opus", hooks: { PreToolUse: [LINT] } });
    expect(withoutHook(withHook({}, CHECK_HOOK, L), CHECK_HOOK)).toEqual({});
  });

  it("finds an entry of its own whatever matcher or budget it has", () => {
    const narrow = { matcher: "Write", hooks: [{ type: "command", command: CHECK_HOOK.command }] };
    expect(hasEntry({ hooks: { PreToolUse: [narrow] } }, CHECK_HOOK)).toBe(true);
    expect(hasEntry({ hooks: { PreToolUse: [LINT] } }, CHECK_HOOK)).toBe(false);
    expect(hasEntry({}, CHECK_HOOK)).toBe(false);
  });

  it("refuses a settings file whose hooks are not the shape it claims", () => {
    expect(() => withHook({ hooks: [] }, CHECK_HOOK, L)).toThrow(/hooks .*not an object/);
    expect(() => withHook({ hooks: { PreToolUse: {} } }, CHECK_HOOK, L)).toThrow(/PreToolUse.*not a list/);
  });
});

describe("the command a hook runs", () => {
  /** One SessionEnd entry running `command`, as some earlier install left it. */
  const endingWith = (command: string): Settings => ({
    hooks: { SessionEnd: [{ hooks: [{ type: "command", command, timeout: STOP_HOOK.timeout }] }] },
  });
  const MOVED: Launcher = { node: "/Users/dev/.nvm/versions/node/v20.1.0/bin/node", cli: "/old/session/dist/cli.js" };

  it("names node and the CLI by absolute path, never a bare session", () => {
    // A hook runs under /bin/sh, which has none of the developer's PATH.
    expect(commandLine(STOP_HOOK, L)).toBe("/usr/local/bin/node /opt/session/dist/cli.js stop --if-open");
    expect(commandLine(CHECK_HOOK, L)).toBe("/usr/local/bin/node /opt/session/dist/cli.js hook check");
  });

  it("quotes a path /bin/sh would otherwise split, and still knows it for its own", () => {
    const spaced: Launcher = { node: "/Applications/My Node/bin/node", cli: "/Users/o'neil/session/dist/cli.js" };
    const command = commandLine(STOP_HOOK, spaced);
    expect(command).toBe(`'/Applications/My Node/bin/node' '/Users/o'\\''neil/session/dist/cli.js' stop --if-open`);
    expect(hasHook(endingWith(command), STOP_HOOK, spaced)).toBe(true);
  });

  it("defaults to the node running it and the cli.js beside the command module", () => {
    const launcher = currentLauncher();
    expect(launcher.node).toBe(process.execPath);
    expect(launcher.cli).toBe(path.resolve(import.meta.dirname, "../src/cli.js"));
  });

  it.each([
    ["a bare session", "session stop --if-open"],
    ["a launcher that has since moved", commandLine(STOP_HOOK, MOVED)],
    ["a session shim by absolute path", "/opt/homebrew/bin/session stop --if-open"],
  ])("rewrites %s in place, and reads it as needing that repair", (_, command) => {
    const settings = endingWith(command);
    expect(hasEntry(settings, STOP_HOOK)).toBe(true);
    expect(hasHook(settings, STOP_HOOK, L)).toBe(false);
    expect(withHooks(settings, wantedHooks(false), L)).toEqual(MANUAL);
  });

  it("takes any of those back out on uninstall", () => {
    expect(withoutHooks(endingWith(commandLine(STOP_HOOK, MOVED)))).toEqual({});
    expect(withoutHooks(endingWith("/opt/homebrew/bin/session stop --if-open"))).toEqual({});
  });

  it.each([
    "session stop --if-open && say done",
    "session stop",
    "npx session stop --if-open",
    "node cli.js stop --if-open",
    '"/usr/local/bin/node" /x/dist/cli.js stop --if-open',
  ])("leaves %j alone, since it is not a command this tool wrote", (command) => {
    const settings = endingWith(command);
    expect(hasEntry(settings, STOP_HOOK)).toBe(false);
    expect(withHooks(settings, wantedHooks(false), L)["hooks"]).toEqual({
      SessionEnd: [...(settings["hooks"] as { SessionEnd: unknown[] }).SessionEnd, STOP],
    });
  });

  it("counts every command, on any event, that starts with a bare session", () => {
    const settings: Settings = {
      hooks: {
        SessionEnd: [STALE, THEIRS],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "session hook check" }] }],
        SessionStart: [OPEN],
        Stop: "nonsense",
      },
    };
    expect(bareSessionCommands(settings)).toBe(2);
    expect(bareSessionCommands({})).toBe(0);
  });
});

describe("installHook", () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "session-hook-"));
    file = path.join(root, "settings.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(settings: unknown): Promise<void> {
    await writeFile(file, JSON.stringify(settings, null, 2), "utf8");
  }

  async function read(): Promise<Settings> {
    return JSON.parse(await readFile(file, "utf8")) as Settings;
  }

  it("registers all three hooks in the settings file", async () => {
    await write({ model: "opus" });

    const result = await installHook({ settings: file, launcher: L });

    expect(result).toEqual({
      file,
      tool: "Claude Code",
      hooks: [STOP_HOOK, OPEN_HOOK, PROMPT_HOOK],
      changed: true,
      action: "installed",
      launcher: L,
      bare: { before: 0, after: 0 },
    });
    await expect(read()).resolves.toEqual({ model: "opus", ...installed("claude-code") });
  });

  it("registers the closer alone with --passive=false", async () => {
    await write({ model: "opus" });

    const result = await installHook({ settings: file, launcher: L, passive: false });

    expect(result.hooks).toEqual([STOP_HOOK]);
    await expect(read()).resolves.toEqual({ model: "opus", ...MANUAL });
  });

  it("takes passive capture back out when asked to install without it", async () => {
    await write({});
    await installHook({ settings: file, launcher: L });

    const result = await installHook({ settings: file, launcher: L, passive: false });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual(MANUAL);
  });

  it("puts passive capture back when asked for it again", async () => {
    await write({});
    await installHook({ settings: file, launcher: L, passive: false });

    const result = await installHook({ settings: file, launcher: L, passive: true });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual(installed("claude-code"));
  });

  it("writes JSON a person can read, and ends the file with a newline", async () => {
    await write({});

    await installHook({ settings: file, launcher: L });

    const text = await readFile(file, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "hooks": {');
  });

  it("upgrades a hook an older session installed, and says it changed", async () => {
    await write({ hooks: { [STOP_HOOK.event]: [STALE] } });

    const result = await installHook({ settings: file, launcher: L, passive: false });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual(MANUAL);
  });

  it("rewrites a launcher that has moved, and counts the bare session it replaced", async () => {
    await write({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "session stop --if-open", timeout: 30 }] }] } });

    const result = await installHook({ settings: file, launcher: L, passive: false });

    expect(result.changed).toBe(true);
    expect(result.bare).toEqual({ before: 1, after: 0 });
    await expect(read()).resolves.toEqual(MANUAL);

    const moved = { node: "/elsewhere/node", cli: "/elsewhere/dist/cli.js" };
    expect((await installHook({ settings: file, launcher: moved, passive: false })).changed).toBe(true);
    await expect(read()).resolves.toEqual({
      hooks: { SessionEnd: [{ hooks: [{ type: "command", command: commandLine(STOP_HOOK, moved), timeout: 30 }] }] },
    });
  });

  it("names the file when its hooks are not the shape it expects", async () => {
    await write({ hooks: "nonsense" });

    await expect(installHook({ settings: file, launcher: L })).rejects.toThrow(`${file}: hooks in the settings file is not an object`);
  });

  it("says it changed nothing when the hooks are already registered", async () => {
    await write({});
    await installHook({ settings: file, launcher: L });
    const first = await stat(file);

    const result = await installHook({ settings: file, launcher: L });

    expect(result.changed).toBe(false);
    // Unchanged means untouched: the file is not rewritten with identical bytes.
    expect((await stat(file)).mtimeMs).toBe(first.mtimeMs);
  });

  it("keeps the file readable by whoever could read it before", async () => {
    await write({});
    await chmod(file, 0o600);

    await installHook({ settings: file, launcher: L });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("leaves no staging file behind", async () => {
    await write({});

    await installHook({ settings: file, launcher: L });

    await expect(stat(`${file}.session-tmp`)).rejects.toThrow();
  });

  it("treats an empty settings file as empty settings", async () => {
    await writeFile(file, "", "utf8");

    await installHook({ settings: file, launcher: L });

    await expect(read()).resolves.toEqual(installed("claude-code"));
  });

  it("says where it looked when there is no settings file", async () => {
    await expect(installHook({ settings: file, launcher: L })).rejects.toThrow(
      new RegExp(`No Claude Code settings file at ${file}`),
    );
  });

  it("says what to do when there is no settings file", async () => {
    await expect(installHook({ settings: file, launcher: L })).rejects.toThrow(/Start Claude Code once/);
  });

  it("refuses a settings file that is not valid JSON", async () => {
    await writeFile(file, "{ not json", "utf8");

    await expect(installHook({ settings: file, launcher: L })).rejects.toThrow(/is not valid JSON/);
  });

  it("refuses a settings file that is not a JSON object", async () => {
    await writeFile(file, "[1, 2, 3]", "utf8");

    await expect(installHook({ settings: file, launcher: L })).rejects.toThrow(/is not a JSON object/);
  });

  it("leaves a settings file it refused exactly as it found it", async () => {
    await writeFile(file, "{ not json", "utf8");

    await expect(installHook({ settings: file, launcher: L })).rejects.toThrow();
    await expect(readFile(file, "utf8")).resolves.toBe("{ not json");
  });

  it("defaults to the Claude Code user settings file", () => {
    expect(settingsFile()).toMatch(/\.claude[/\\]settings\.json$/);
    expect(settingsFile({ settings: "/somewhere/else.json" })).toBe("/somewhere/else.json");
  });
});

describe("installRepoHooks", () => {
  let root: string;
  let repo: string;
  let local: string;
  let user: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "session-repo-hooks-")));
    repo = path.join(root, "repo");
    await mkdir(path.join(repo, "src"), { recursive: true });
    await runGit(repo, ["init", "-q"]);
    local = path.join(repo, ".claude", "settings.local.json");
    user = path.join(root, "settings.json");
    await writeFile(user, JSON.stringify({ hooks: { SessionEnd: [STOP] } }), "utf8");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const read = async (): Promise<Settings> => JSON.parse(await readFile(local, "utf8")) as Settings;
  const CHECK = {
    matcher: CHECK_HOOK.matcher,
    hooks: [{ type: "command", command: commandLine(CHECK_HOOK, L), timeout: CHECK_HOOK.timeout }],
  };

  it("writes the check into this repository's own settings, creating them", async () => {
    const result = await installRepoHooks({ cwd: repo, launcher: L });
    expect(result).toEqual({
      file: local,
      tool: "Claude Code",
      hooks: [CHECK_HOOK],
      changed: true,
      action: "installed",
      launcher: L,
      bare: { before: 0, after: 0 },
    });
    expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("finds the repository root from a subdirectory", async () => {
    expect(await repoSettingsFile({ cwd: path.join(repo, "src") })).toBe(local);
  });

  it("keeps every other setting and hook in the file", async () => {
    await mkdir(path.dirname(local));
    const theirs = { permissions: { allow: ["Bash(npm test)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit" }] }] } };
    await writeFile(local, JSON.stringify(theirs), "utf8");
    await installRepoHooks({ cwd: repo, launcher: L });
    expect(await read()).toEqual({
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PreToolUse: [theirs.hooks.PreToolUse[0], CHECK] },
    });
  });

  it("leaves the file untouched when the check is already there", async () => {
    await installRepoHooks({ cwd: repo, launcher: L });
    const before = await stat(local);
    const again = await installRepoHooks({ cwd: repo, launcher: L });
    expect(again.changed).toBe(false);
    expect((await stat(local)).mtimeMs).toBe(before.mtimeMs);
    expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("keeps the file's permissions", async () => {
    await mkdir(path.dirname(local));
    await writeFile(local, "{}", "utf8");
    await chmod(local, 0o600);
    await installRepoHooks({ cwd: repo, launcher: L });
    expect((await stat(local)).mode & 0o777).toBe(0o600);
  });

  it("refuses a file that is not valid JSON, and leaves it as it was", async () => {
    await mkdir(path.dirname(local));
    await writeFile(local, "{ nope", "utf8");
    await expect(installRepoHooks({ cwd: repo, launcher: L })).rejects.toThrow(/not valid JSON/);
    expect(await readFile(local, "utf8")).toBe("{ nope");
  });

  it("refuses outside a repository, writing nothing", async () => {
    await expect(installRepoHooks({ cwd: root, launcher: L })).rejects.toThrow(/Not inside a git repository/);
  });

  it("never reads or writes the user-level settings", async () => {
    const before = await readFile(user, "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram({ cwd: repo, settings: user, launcher: L }).parseAsync(["node", "session", "hook", "install", "--repo"]);
    expect(await readFile(user, "utf8")).toBe(before);
    expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
    expect(log.mock.calls.flat().join("\n")).toContain("PreToolUse (Edit|Write|MultiEdit|NotebookEdit|Bash) → session hook check");
  });

  it.each([
    [["--no-passive"], /--passive applies to the user-level hooks/],
    [["--passive=false"], /--passive applies to the user-level hooks/],
  ])("refuses --repo with %j, changing nothing", async (extra, message) => {
    const before = await readFile(user, "utf8");
    const program = buildProgram({ cwd: repo, settings: user, launcher: L });
    await expect(program.parseAsync(["node", "session", "hook", "install", "--repo", ...extra])).rejects.toThrow(message);
    expect(await readFile(user, "utf8")).toBe(before);
    await expect(stat(local)).rejects.toThrow();
  });

  describe("--uninstall", () => {
    const AUDIT = { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] };

    it("takes the check out and leaves every other setting and hook", async () => {
      await mkdir(path.dirname(local));
      await writeFile(local, JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [AUDIT] } }), "utf8");
      await installRepoHooks({ cwd: repo, launcher: L });
      const result = await uninstallRepoHooks({ cwd: path.join(repo, "src"), launcher: L });
      expect(result).toEqual({
        file: local,
        tool: "Claude Code",
        hooks: [],
        changed: true,
        action: "removed",
        bare: { before: 0, after: 0 },
      });
      expect(await read()).toEqual({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [AUDIT] } });
    });

    it("leaves an emptied file as {}, not deleted", async () => {
      await installRepoHooks({ cwd: repo, launcher: L });
      await uninstallRepoHooks({ cwd: repo, launcher: L });
      expect(await read()).toEqual({});
    });

    it("removes an entry filed under another matcher too", async () => {
      await mkdir(path.dirname(local));
      const narrow = { matcher: "Write", hooks: [{ type: "command", command: "lint" }, { type: "command", command: CHECK_HOOK.command }] };
      await writeFile(local, JSON.stringify({ hooks: { PreToolUse: [narrow] } }), "utf8");
      await uninstallRepoHooks({ cwd: repo, launcher: L });
      expect(await read()).toEqual({ hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "lint" }] }] } });
    });

    it("creates nothing when the repository has no settings file", async () => {
      const result = await uninstallRepoHooks({ cwd: repo, launcher: L });
      expect(result.changed).toBe(false);
      await expect(stat(local)).rejects.toThrow();
    });

    it("leaves a file without the check exactly as it was, even an empty list", async () => {
      await mkdir(path.dirname(local));
      const text = JSON.stringify({ hooks: { PreToolUse: [] } });
      await writeFile(local, text, "utf8");
      const before = await stat(local);
      expect((await uninstallRepoHooks({ cwd: repo, launcher: L })).changed).toBe(false);
      expect(await readFile(local, "utf8")).toBe(text);
      expect((await stat(local)).mtimeMs).toBe(before.mtimeMs);
    });

    it("refuses invalid JSON and non-repositories, writing nothing", async () => {
      await mkdir(path.dirname(local));
      await writeFile(local, "{ nope", "utf8");
      await expect(uninstallRepoHooks({ cwd: repo, launcher: L })).rejects.toThrow(/not valid JSON/);
      expect(await readFile(local, "utf8")).toBe("{ nope");
      await expect(uninstallRepoHooks({ cwd: root, launcher: L })).rejects.toThrow(/Not inside a git repository/);
    });

    it("never touches the user-level hooks, through the CLI", async () => {
      await installRepoHooks({ cwd: repo, launcher: L });
      const before = await readFile(user, "utf8");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await buildProgram({ cwd: repo, settings: user, launcher: L }).parseAsync(["node", "session", "hook", "install", "--repo", "--uninstall"]);
      expect(await readFile(user, "utf8")).toBe(before);
      expect(await read()).toEqual({});
      expect(log.mock.calls.flat().join("\n")).toMatch(/removed .*settings\.local\.json[\s\S]*none registered/);
    });

    it("is not undone by the user-level uninstall", async () => {
      // Pointed at the repository file, the user-level removal still leaves the check.
      await installRepoHooks({ cwd: repo, launcher: L });
      await uninstallHook({ settings: local });
      expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
    });
  });
});

describe("installCodexHooks", () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "session-codex-"));
    file = path.join(root, ".codex", "hooks.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const read = async (): Promise<Settings> => JSON.parse(await readFile(file, "utf8")) as Settings;

  it("does nothing on a machine without Codex, and makes no directory for it", async () => {
    expect(await installCodexHooks({ codexHooks: file, launcher: L })).toBeUndefined();
    expect(await uninstallCodexHooks({ codexHooks: file })).toBeUndefined();
    await expect(stat(path.dirname(file))).rejects.toThrow();
  });

  it("writes the same hooks as Claude Code's, creating hooks.json", async () => {
    await mkdir(path.dirname(file));

    const result = await installCodexHooks({ codexHooks: file, launcher: L });

    expect(result).toMatchObject({ file, tool: "Codex", changed: true, action: "installed" });
    expect(await read()).toEqual(installed("codex"));
  });

  it("rewrites the bare commands an earlier setup wrote, where they stand", async () => {
    await mkdir(path.dirname(file));
    const bare = (hook: HookSpec, timeout: number) => [{ hooks: [{ type: "command", command: hook.command, timeout }] }];
    await writeFile(file, JSON.stringify({
      hooks: { SessionStart: bare(OPEN_HOOK, 10), SessionEnd: bare(STOP_HOOK, 10), UserPromptSubmit: bare(PROMPT_HOOK, 5) },
    }), "utf8");

    const result = await installCodexHooks({ codexHooks: file, launcher: L });

    expect(result?.bare).toEqual({ before: 3, after: 0 });
    expect(await read()).toEqual(installed("codex"));
  });

  it("follows passive capture the same way", async () => {
    await mkdir(path.dirname(file));
    await installCodexHooks({ codexHooks: file, launcher: L });

    await installCodexHooks({ codexHooks: file, launcher: L, passive: false });

    expect(await read()).toEqual(MANUAL);
  });

  it("takes them back out", async () => {
    await mkdir(path.dirname(file));
    await installCodexHooks({ codexHooks: file, launcher: L });

    const result = await uninstallCodexHooks({ codexHooks: file });

    expect(result).toMatchObject({ tool: "Codex", changed: true, action: "removed" });
    expect(await read()).toEqual({});
  });

  it("refuses a hooks.json that is not JSON, naming it as Codex's", async () => {
    await mkdir(path.dirname(file));
    await writeFile(file, "{ nope", "utf8");

    await expect(installCodexHooks({ codexHooks: file, launcher: L })).rejects.toThrow(
      `The Codex hooks file at ${file} is not valid JSON`,
    );
  });

  it("lives in CODEX_HOME when that is set, and in ~/.codex otherwise", () => {
    const saved = process.env["CODEX_HOME"];
    try {
      process.env["CODEX_HOME"] = "/srv/codex";
      expect(codexHooksFile()).toBe(path.join("/srv/codex", "hooks.json"));
      delete process.env["CODEX_HOME"];
      expect(codexHooksFile()).toMatch(/\.codex[/\\]hooks\.json$/);
    } finally {
      if (saved === undefined) delete process.env["CODEX_HOME"];
      else process.env["CODEX_HOME"] = saved;
    }
  });
});

describe("uninstallHook", () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "session-hook-"));
    file = path.join(root, "settings.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("takes every hook back out of the settings file", async () => {
    await writeFile(file, JSON.stringify({ model: "opus" }), "utf8");
    await installHook({ settings: file, launcher: L });

    const result = await uninstallHook({ settings: file, launcher: L });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("removed");
    expect(result.hooks).toEqual([]);
    await expect(readFile(file, "utf8")).resolves.toBe('{\n  "model": "opus"\n}\n');
  });

  it("says it changed nothing when no hook was ever registered", async () => {
    await writeFile(file, JSON.stringify({ model: "opus" }), "utf8");

    const result = await uninstallHook({ settings: file, launcher: L });

    expect(result.changed).toBe(false);
    await expect(readFile(file, "utf8")).resolves.toBe('{"model":"opus"}');
  });

  it("says where it looked when there is no settings file", async () => {
    await expect(uninstallHook({ settings: file, launcher: L })).rejects.toThrow(/No Claude Code settings file/);
  });
});

describe("formatHook", () => {
  const result: HookResult = {
    file: "/Users/dev/.claude/settings.json",
    tool: "Claude Code",
    hooks: [STOP_HOOK, OPEN_HOOK, PROMPT_HOOK],
    changed: true,
    action: "installed",
    launcher: L,
    bare: { before: 0, after: 0 },
  };
  const VIA = "  via      /usr/local/bin/node /opt/session/dist/cli.js";

  it("prints what it wrote, where, and every hook the file now holds", () => {
    expect(formatHook(result)).toEqual([
      "  wrote    /Users/dev/.claude/settings.json",
      "  hook     SessionEnd → session stop --if-open",
      "  hook     SessionStart → session start --passive",
      "  hook     UserPromptSubmit → session intent --from-prompt",
      VIA,
    ]);
  });

  it("prints one hook when passive capture was turned off", () => {
    // Which hooks are registered is the whole difference between the two
    // arrangements, so it is listed rather than counted.
    expect(formatHook({ ...result, hooks: [STOP_HOOK] })).toEqual([
      "  wrote    /Users/dev/.claude/settings.json",
      "  hook     SessionEnd → session stop --if-open",
      VIA,
    ]);
  });

  it("says what session stands for, whether or not it wrote anything", () => {
    expect(formatHook({ ...result, changed: false }).at(-1)).toBe(VIA);
  });

  it("says in one line that it replaced hooks running a bare session", () => {
    const lines = formatHook({ ...result, bare: { before: 3, after: 0 } });
    expect(lines.filter((line) => line.includes("bare session"))).toEqual([
      "  note     replaced 3 hooks that ran a bare session, which a hook's /bin/sh may not find",
    ]);
  });

  it("says in one line when a bare session is left that it does not own", () => {
    const lines = formatHook({ ...result, bare: { before: 2, after: 1 } });
    expect(lines.filter((line) => line.includes("bare session"))).toEqual([
      "  note     1 other hook runs a bare session, which a hook's /bin/sh may not find: edit by hand",
    ]);
  });

  it("says nothing about a bare session it did not find, or when removing", () => {
    expect(formatHook(result).join("\n")).not.toContain("bare");
    expect(formatHook({ ...result, action: "removed", hooks: [], bare: { before: 1, after: 0 } }).join("\n")).not.toContain("bare");
  });

  it("says Codex must approve hooks it changed, and only then", () => {
    const codex: HookResult = { ...result, file: "/Users/dev/.codex/hooks.json", tool: "Codex" };
    const note = "  note     Codex holds changed hooks back until they are approved: run /hooks in Codex";
    expect(formatHook(codex).at(-1)).toBe(note);
    expect(formatHook({ ...codex, changed: false })).not.toContain(note);
    expect(formatHook({ ...codex, action: "removed", hooks: [] })).not.toContain(note);
  });

  it("says when the hooks were already there", () => {
    expect(formatHook({ ...result, changed: false })[0]).toBe(
      "  already  /Users/dev/.claude/settings.json",
    );
  });

  it("says when it removed them, and that none are left", () => {
    expect(formatHook({ ...result, action: "removed", hooks: [] })).toEqual([
      "  removed  /Users/dev/.claude/settings.json",
      "  hook     none registered",
    ]);
  });

  it("names the tools a matched hook fires for", () => {
    expect(formatHook({ ...result, hooks: [CHECK_HOOK] })[1]).toBe(
      "  hook     PreToolUse (Edit|Write|MultiEdit|NotebookEdit|Bash) → session hook check",
    );
  });

  it("says when there was no hook to remove", () => {
    expect(formatHook({ ...result, action: "removed", hooks: [], changed: false })[0]).toBe(
      "  not set  /Users/dev/.claude/settings.json",
    );
  });

  it("lines the two labels up in one column", () => {
    const [first, second] = formatHook(result);

    expect(first?.indexOf("/Users")).toBe(second?.indexOf("SessionEnd"));
  });

  it("uses no colour, no emoji and no exclamation", () => {
    for (const line of formatHook(result)) {
      expect(line).not.toMatch(/\[/);
      expect(line).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      expect(line).not.toContain("!");
    }
  });
});
