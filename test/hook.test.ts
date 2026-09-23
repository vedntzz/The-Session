import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGit } from "../src/git.js";
import { buildProgram } from "../src/program.js";
import {
  CHECK_HOOK,
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
  type Settings,
} from "../src/capture/hook.js";
import {
  repoSettingsFile,
  formatHook,
  installRepoHooks,
  installHook,
  uninstallRepoHooks,
  settingsFile,
  uninstallHook,
  type HookResult,
} from "../src/commands/hook.js";

/** The group `withHooks` writes for one hook, as it appears in a settings file. */
function group(hook: HookSpec): Record<string, unknown> {
  return { hooks: [{ type: "command", command: hook.command, timeout: hook.timeout }] };
}

const STOP = group(STOP_HOOK);
const OPEN = group(OPEN_HOOK);
const PROMPT = group(PROMPT_HOOK);

/** The group a `session` from before the timeout wrote. */
const STALE = { hooks: [{ type: "command", command: STOP_HOOK.command }] };
/** Somebody else's SessionEnd hook, which must survive every operation. */
const THEIRS = { hooks: [{ type: "command", command: "say goodbye" }] };

/** What a settings file holds after a full install. */
const ALL: Settings = {
  hooks: {
    [STOP_HOOK.event]: [STOP],
    [OPEN_HOOK.event]: [OPEN],
    [PROMPT_HOOK.event]: [PROMPT],
  },
};

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
    const hooks = withHooks({}, HOOKS)["hooks"] as Record<string, unknown>;

    for (const hook of HOOKS) {
      const groups = hooks[hook.event] as Record<string, unknown>[];
      expect(groups).toHaveLength(1);
      expect("matcher" in (groups[0] as Record<string, unknown>)).toBe(false);
    }
  });

  it("nests each handler inside a matcher group, as the settings schema wants", () => {
    expect(withHooks({}, HOOKS)).toEqual(ALL);
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
    expect(hasHooks(ALL, HOOKS)).toBe(true);
  });

  it("is false for settings with no hooks at all", () => {
    expect(hasHooks({}, HOOKS)).toBe(false);
    expect(hasHooks({ model: "opus" }, HOOKS)).toBe(false);
  });

  it("is false when only some of them are registered", () => {
    expect(hasHooks(MANUAL, HOOKS)).toBe(false);
  });

  it("is false when a passive hook is registered and passive capture was not asked for", () => {
    // Otherwise `--passive=false` over a passive install would report
    // "already" and leave two hooks opening sessions nobody asked for.
    expect(hasHooks(ALL, wantedHooks(false))).toBe(false);
  });

  it("is true for the closer alone when that is all that was asked for", () => {
    expect(hasHooks(MANUAL, wantedHooks(false))).toBe(true);
  });

  it("is true for settings with none of them when none were asked for", () => {
    expect(hasHooks({ model: "opus" }, [])).toBe(true);
  });

  it("is false when someone else's hook is the only one there", () => {
    expect(hasHooks({ hooks: { [STOP_HOOK.event]: [THEIRS] } }, wantedHooks(false))).toBe(false);
  });

  it("is false when a hook is registered against the wrong event", () => {
    expect(hasHooks({ hooks: { PreToolUse: [STOP] } }, wantedHooks(false))).toBe(false);
  });

  it("is false for an entry left by a session that wrote no timeout", () => {
    expect(hasHooks({ hooks: { [STOP_HOOK.event]: [STALE] } }, wantedHooks(false))).toBe(false);
  });

  it("reads a malformed hooks section as no hooks, rather than throwing", () => {
    expect(hasHooks({ hooks: "nonsense" }, HOOKS)).toBe(false);
    expect(hasHooks({ hooks: { [STOP_HOOK.event]: "nonsense" } }, HOOKS)).toBe(false);
  });

  it("asks the same question of one hook as hasHook does", () => {
    expect(hasHook(MANUAL, STOP_HOOK)).toBe(true);
    expect(hasHook(MANUAL, OPEN_HOOK)).toBe(false);
  });
});

describe("withHooks", () => {
  it("registers them in settings that had none", () => {
    expect(withHooks({}, HOOKS)).toEqual(ALL);
  });

  it("registers the closer alone when that is what was asked for", () => {
    expect(withHooks({}, wantedHooks(false))).toEqual(MANUAL);
  });

  it("takes the passive hooks back out when they are no longer wanted", () => {
    // Turning capture off is a statement about the file, not an omission from
    // it: a flag that could not be changed its mind about would be a trap.
    expect(withHooks(ALL, wantedHooks(false))).toEqual(MANUAL);
  });

  it("adds the passive hooks to an installation that had only the closer", () => {
    expect(withHooks(MANUAL, HOOKS)).toEqual(ALL);
  });

  it("repairs an entry that was registered without a timeout", () => {
    expect(withHooks({ hooks: { [STOP_HOOK.event]: [STALE] } }, wantedHooks(false))).toEqual(
      MANUAL,
    );
  });

  it("repairs that entry in place rather than adding a second one", () => {
    const next = withHooks({ hooks: { [STOP_HOOK.event]: [THEIRS, STALE] } }, wantedHooks(false));

    // Two hooks both closing the session would double-count the work.
    expect(next).toEqual({ hooks: { [STOP_HOOK.event]: [THEIRS, STOP] } });
  });

  it("registers each of them once, however many times it is asked", () => {
    const once = withHooks({}, HOOKS);
    expect(withHooks(once, HOOKS)).toEqual(once);
    expect(withHooks(withHooks(once, HOOKS), HOOKS)).toEqual(once);
  });

  it("leaves every other setting alone", () => {
    const settings: Settings = { model: "opus", theme: "dark", tui: { compact: true } };
    const next = withHooks(settings, HOOKS);

    expect(next["model"]).toBe("opus");
    expect(next["theme"]).toBe("dark");
    expect(next["tui"]).toEqual({ compact: true });
  });

  it("keeps other hooks on the same event, and adds itself after them", () => {
    const next = withHooks({ hooks: { [STOP_HOOK.event]: [THEIRS] } }, wantedHooks(false));

    expect(next).toEqual({ hooks: { [STOP_HOOK.event]: [THEIRS, STOP] } });
  });

  it("keeps hooks registered on events it knows nothing about", () => {
    const next = withHooks({ hooks: { PreToolUse: [THEIRS] } }, wantedHooks(false));

    expect(next).toEqual({ hooks: { PreToolUse: [THEIRS], [STOP_HOOK.event]: [STOP] } });
  });

  it("keeps somebody else's SessionStart hook when it takes its own back out", () => {
    const theirs = { hooks: { [OPEN_HOOK.event]: [THEIRS, OPEN] } };

    expect(withHooks(theirs, [])).toEqual({ hooks: { [OPEN_HOOK.event]: [THEIRS] } });
  });

  it("does not touch what it was given", () => {
    const settings: Settings = { hooks: { [STOP_HOOK.event]: [THEIRS] } };
    const before = structuredClone(settings);

    withHooks(settings, HOOKS);

    expect(settings).toEqual(before);
  });

  it("refuses to overwrite a hooks section that is not an object", () => {
    expect(() => withHooks({ hooks: "nonsense" }, HOOKS)).toThrow(/is not an object/);
  });

  it("refuses to overwrite a SessionEnd section that is not a list", () => {
    expect(() => withHooks({ hooks: { [STOP_HOOK.event]: { nope: true } } }, HOOKS)).toThrow(
      /is not a list/,
    );
  });

  it("names the event it refused, so a settings file can be fixed by hand", () => {
    expect(() => withHooks({ hooks: { [PROMPT_HOOK.event]: 7 } }, HOOKS)).toThrow(
      /hooks\.UserPromptSubmit/,
    );
  });
});

describe("withoutHooks", () => {
  it("takes all three back out", () => {
    expect(withoutHooks(withHooks({}, HOOKS))).toEqual({});
  });

  it("prunes the containers it created, and nothing more", () => {
    const next = withoutHooks(withHooks({ model: "opus" }, HOOKS));

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
    hooks: [{ type: "command", command: CHECK_HOOK.command, timeout: CHECK_HOOK.timeout }],
  };
  /** Somebody else's PreToolUse hook, which must survive every operation. */
  const LINT = { matcher: "Write", hooks: [{ type: "command", command: "lint --staged" }] };

  it("runs the check before the file tools and shell commands, and nothing else", () => {
    expect(CHECK_HOOK.event).toBe("PreToolUse");
    expect(CHECK_HOOK.command).toBe("session hook check");
    expect(CHECK_HOOK.matcher).toBe("Edit|Write|MultiEdit|Bash");
  });

  it("is never part of what the user-level install registers or removes", () => {
    expect(HOOKS).not.toContain(CHECK_HOOK);
    expect(wantedHooks(true)).not.toContain(CHECK_HOOK);
    const settings = { hooks: { PreToolUse: [CHECK] } };
    expect(withHooks(settings, wantedHooks(true)).hooks).toMatchObject({ PreToolUse: [CHECK] });
    expect(withoutHooks(settings)).toEqual(settings);
  });

  it("files itself under its own matcher, beside everything else", () => {
    const before: Settings = { model: "opus", hooks: { PreToolUse: [LINT], [STOP_HOOK.event]: [STOP] } };
    const after = withHook(before, CHECK_HOOK);
    expect(after).toEqual({
      model: "opus",
      hooks: { PreToolUse: [LINT, CHECK], [STOP_HOOK.event]: [STOP] },
    });
    expect(hasHook(after, CHECK_HOOK)).toBe(true);
  });

  it("does not change the settings it was given", () => {
    const before: Settings = { hooks: { PreToolUse: [LINT] } };
    const copy = structuredClone(before);
    withHook(before, CHECK_HOOK);
    expect(before).toEqual(copy);
  });

  it("registers once, however many times it is added", () => {
    const twice = withHook(withHook({}, CHECK_HOOK), CHECK_HOOK);
    expect(twice).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("is not registered under another matcher, and is moved rather than duplicated", () => {
    // A group narrower than the hook's own would let Edit through unchecked.
    const narrow = {
      matcher: "Write",
      hooks: [{ type: "command", command: "lint --staged" }, CHECK.hooks[0]],
    };
    const settings: Settings = { hooks: { PreToolUse: [narrow] } };
    expect(hasHook(settings, CHECK_HOOK)).toBe(false);
    expect(withHook(settings, CHECK_HOOK)).toEqual({ hooks: { PreToolUse: [LINT, CHECK] } });
  });

  it("treats an install from before shell commands were checked as needing repair", () => {
    const before = { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: CHECK_HOOK.command, timeout: CHECK_HOOK.timeout }] };
    const settings: Settings = { hooks: { PreToolUse: [before] } };
    expect(hasHook(settings, CHECK_HOOK)).toBe(false);
    expect(withHook(settings, CHECK_HOOK)).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("repairs an entry on the wrong budget where it stands", () => {
    const stale = { matcher: CHECK_HOOK.matcher, hooks: [{ type: "command", command: CHECK_HOOK.command }] };
    const settings: Settings = { hooks: { PreToolUse: [stale] } };
    expect(hasHook(settings, CHECK_HOOK)).toBe(false);
    expect(withHook(settings, CHECK_HOOK)).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("comes back out alone, pruning only what it emptied", () => {
    const installed = withHook({ model: "opus", hooks: { PreToolUse: [LINT] } }, CHECK_HOOK);
    expect(withoutHook(installed, CHECK_HOOK)).toEqual({ model: "opus", hooks: { PreToolUse: [LINT] } });
    expect(withoutHook(withHook({}, CHECK_HOOK), CHECK_HOOK)).toEqual({});
  });

  it("finds an entry of its own whatever matcher or budget it has", () => {
    const narrow = { matcher: "Write", hooks: [{ type: "command", command: CHECK_HOOK.command }] };
    expect(hasEntry({ hooks: { PreToolUse: [narrow] } }, CHECK_HOOK)).toBe(true);
    expect(hasEntry({ hooks: { PreToolUse: [LINT] } }, CHECK_HOOK)).toBe(false);
    expect(hasEntry({}, CHECK_HOOK)).toBe(false);
  });

  it("refuses a settings file whose hooks are not the shape it claims", () => {
    expect(() => withHook({ hooks: [] }, CHECK_HOOK)).toThrow(/hooks .*not an object/);
    expect(() => withHook({ hooks: { PreToolUse: {} } }, CHECK_HOOK)).toThrow(/PreToolUse.*not a list/);
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

    const result = await installHook({ settings: file });

    expect(result).toEqual({
      file,
      hooks: [STOP_HOOK, OPEN_HOOK, PROMPT_HOOK],
      changed: true,
      action: "installed",
    });
    await expect(read()).resolves.toEqual({ model: "opus", ...ALL });
  });

  it("registers the closer alone with --passive=false", async () => {
    await write({ model: "opus" });

    const result = await installHook({ settings: file, passive: false });

    expect(result.hooks).toEqual([STOP_HOOK]);
    await expect(read()).resolves.toEqual({ model: "opus", ...MANUAL });
  });

  it("takes passive capture back out when asked to install without it", async () => {
    await write({});
    await installHook({ settings: file });

    const result = await installHook({ settings: file, passive: false });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual(MANUAL);
  });

  it("puts passive capture back when asked for it again", async () => {
    await write({});
    await installHook({ settings: file, passive: false });

    const result = await installHook({ settings: file, passive: true });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual(ALL);
  });

  it("writes JSON a person can read, and ends the file with a newline", async () => {
    await write({});

    await installHook({ settings: file });

    const text = await readFile(file, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "hooks": {');
  });

  it("upgrades a hook an older session installed, and says it changed", async () => {
    await write({ hooks: { [STOP_HOOK.event]: [STALE] } });

    const result = await installHook({ settings: file, passive: false });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual(MANUAL);
  });

  it("says it changed nothing when the hooks are already registered", async () => {
    await write({});
    await installHook({ settings: file });
    const first = await stat(file);

    const result = await installHook({ settings: file });

    expect(result.changed).toBe(false);
    // Unchanged means untouched: the file is not rewritten with identical bytes.
    expect((await stat(file)).mtimeMs).toBe(first.mtimeMs);
  });

  it("keeps the file readable by whoever could read it before", async () => {
    await write({});
    await chmod(file, 0o600);

    await installHook({ settings: file });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("leaves no staging file behind", async () => {
    await write({});

    await installHook({ settings: file });

    await expect(stat(`${file}.session-tmp`)).rejects.toThrow();
  });

  it("treats an empty settings file as empty settings", async () => {
    await writeFile(file, "", "utf8");

    await installHook({ settings: file });

    await expect(read()).resolves.toEqual(ALL);
  });

  it("says where it looked when there is no settings file", async () => {
    await expect(installHook({ settings: file })).rejects.toThrow(
      new RegExp(`No Claude Code settings file at ${file}`),
    );
  });

  it("says what to do when there is no settings file", async () => {
    await expect(installHook({ settings: file })).rejects.toThrow(/Start Claude Code once/);
  });

  it("refuses a settings file that is not valid JSON", async () => {
    await writeFile(file, "{ not json", "utf8");

    await expect(installHook({ settings: file })).rejects.toThrow(/is not valid JSON/);
  });

  it("refuses a settings file that is not a JSON object", async () => {
    await writeFile(file, "[1, 2, 3]", "utf8");

    await expect(installHook({ settings: file })).rejects.toThrow(/is not a JSON object/);
  });

  it("leaves a settings file it refused exactly as it found it", async () => {
    await writeFile(file, "{ not json", "utf8");

    await expect(installHook({ settings: file })).rejects.toThrow();
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
    hooks: [{ type: "command", command: CHECK_HOOK.command, timeout: CHECK_HOOK.timeout }],
  };

  it("writes the check into this repository's own settings, creating them", async () => {
    const result = await installRepoHooks({ cwd: repo });
    expect(result).toEqual({ file: local, hooks: [CHECK_HOOK], changed: true, action: "installed" });
    expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("finds the repository root from a subdirectory", async () => {
    expect(await repoSettingsFile({ cwd: path.join(repo, "src") })).toBe(local);
  });

  it("keeps every other setting and hook in the file", async () => {
    await mkdir(path.dirname(local));
    const theirs = { permissions: { allow: ["Bash(npm test)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit" }] }] } };
    await writeFile(local, JSON.stringify(theirs), "utf8");
    await installRepoHooks({ cwd: repo });
    expect(await read()).toEqual({
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PreToolUse: [theirs.hooks.PreToolUse[0], CHECK] },
    });
  });

  it("leaves the file untouched when the check is already there", async () => {
    await installRepoHooks({ cwd: repo });
    const before = await stat(local);
    const again = await installRepoHooks({ cwd: repo });
    expect(again.changed).toBe(false);
    expect((await stat(local)).mtimeMs).toBe(before.mtimeMs);
    expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
  });

  it("keeps the file's permissions", async () => {
    await mkdir(path.dirname(local));
    await writeFile(local, "{}", "utf8");
    await chmod(local, 0o600);
    await installRepoHooks({ cwd: repo });
    expect((await stat(local)).mode & 0o777).toBe(0o600);
  });

  it("refuses a file that is not valid JSON, and leaves it as it was", async () => {
    await mkdir(path.dirname(local));
    await writeFile(local, "{ nope", "utf8");
    await expect(installRepoHooks({ cwd: repo })).rejects.toThrow(/not valid JSON/);
    expect(await readFile(local, "utf8")).toBe("{ nope");
  });

  it("refuses outside a repository, writing nothing", async () => {
    await expect(installRepoHooks({ cwd: root })).rejects.toThrow(/Not inside a git repository/);
  });

  it("never reads or writes the user-level settings", async () => {
    const before = await readFile(user, "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram({ cwd: repo, settings: user }).parseAsync(["node", "session", "hook", "install", "--repo"]);
    expect(await readFile(user, "utf8")).toBe(before);
    expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
    expect(log.mock.calls.flat().join("\n")).toContain("PreToolUse (Edit|Write|MultiEdit|Bash) → session hook check");
  });

  it.each([
    [["--no-passive"], /--passive applies to the user-level hooks/],
    [["--passive=false"], /--passive applies to the user-level hooks/],
  ])("refuses --repo with %j, changing nothing", async (extra, message) => {
    const before = await readFile(user, "utf8");
    const program = buildProgram({ cwd: repo, settings: user });
    await expect(program.parseAsync(["node", "session", "hook", "install", "--repo", ...extra])).rejects.toThrow(message);
    expect(await readFile(user, "utf8")).toBe(before);
    await expect(stat(local)).rejects.toThrow();
  });

  describe("--uninstall", () => {
    const AUDIT = { matcher: "Bash", hooks: [{ type: "command", command: "audit" }] };

    it("takes the check out and leaves every other setting and hook", async () => {
      await mkdir(path.dirname(local));
      await writeFile(local, JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [AUDIT] } }), "utf8");
      await installRepoHooks({ cwd: repo });
      const result = await uninstallRepoHooks({ cwd: path.join(repo, "src") });
      expect(result).toEqual({ file: local, hooks: [], changed: true, action: "removed" });
      expect(await read()).toEqual({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [AUDIT] } });
    });

    it("leaves an emptied file as {}, not deleted", async () => {
      await installRepoHooks({ cwd: repo });
      await uninstallRepoHooks({ cwd: repo });
      expect(await read()).toEqual({});
    });

    it("removes an entry filed under another matcher too", async () => {
      await mkdir(path.dirname(local));
      const narrow = { matcher: "Write", hooks: [{ type: "command", command: "lint" }, { type: "command", command: CHECK_HOOK.command }] };
      await writeFile(local, JSON.stringify({ hooks: { PreToolUse: [narrow] } }), "utf8");
      await uninstallRepoHooks({ cwd: repo });
      expect(await read()).toEqual({ hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "lint" }] }] } });
    });

    it("creates nothing when the repository has no settings file", async () => {
      const result = await uninstallRepoHooks({ cwd: repo });
      expect(result.changed).toBe(false);
      await expect(stat(local)).rejects.toThrow();
    });

    it("leaves a file without the check exactly as it was, even an empty list", async () => {
      await mkdir(path.dirname(local));
      const text = JSON.stringify({ hooks: { PreToolUse: [] } });
      await writeFile(local, text, "utf8");
      const before = await stat(local);
      expect((await uninstallRepoHooks({ cwd: repo })).changed).toBe(false);
      expect(await readFile(local, "utf8")).toBe(text);
      expect((await stat(local)).mtimeMs).toBe(before.mtimeMs);
    });

    it("refuses invalid JSON and non-repositories, writing nothing", async () => {
      await mkdir(path.dirname(local));
      await writeFile(local, "{ nope", "utf8");
      await expect(uninstallRepoHooks({ cwd: repo })).rejects.toThrow(/not valid JSON/);
      expect(await readFile(local, "utf8")).toBe("{ nope");
      await expect(uninstallRepoHooks({ cwd: root })).rejects.toThrow(/Not inside a git repository/);
    });

    it("never touches the user-level hooks, through the CLI", async () => {
      await installRepoHooks({ cwd: repo });
      const before = await readFile(user, "utf8");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await buildProgram({ cwd: repo, settings: user }).parseAsync(["node", "session", "hook", "install", "--repo", "--uninstall"]);
      expect(await readFile(user, "utf8")).toBe(before);
      expect(await read()).toEqual({});
      expect(log.mock.calls.flat().join("\n")).toMatch(/removed .*settings\.local\.json[\s\S]*none registered/);
    });

    it("is not undone by the user-level uninstall", async () => {
      // Pointed at the repository file, the user-level removal still leaves the check.
      await installRepoHooks({ cwd: repo });
      await uninstallHook({ settings: local });
      expect(await read()).toEqual({ hooks: { PreToolUse: [CHECK] } });
    });
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
    await installHook({ settings: file });

    const result = await uninstallHook({ settings: file });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("removed");
    expect(result.hooks).toEqual([]);
    await expect(readFile(file, "utf8")).resolves.toBe('{\n  "model": "opus"\n}\n');
  });

  it("says it changed nothing when no hook was ever registered", async () => {
    await writeFile(file, JSON.stringify({ model: "opus" }), "utf8");

    const result = await uninstallHook({ settings: file });

    expect(result.changed).toBe(false);
    await expect(readFile(file, "utf8")).resolves.toBe('{"model":"opus"}');
  });

  it("says where it looked when there is no settings file", async () => {
    await expect(uninstallHook({ settings: file })).rejects.toThrow(/No Claude Code settings file/);
  });
});

describe("formatHook", () => {
  const result: HookResult = {
    file: "/Users/dev/.claude/settings.json",
    hooks: [STOP_HOOK, OPEN_HOOK, PROMPT_HOOK],
    changed: true,
    action: "installed",
  };

  it("prints what it wrote, where, and every hook the file now holds", () => {
    expect(formatHook(result)).toEqual([
      "  wrote    /Users/dev/.claude/settings.json",
      "  hook     SessionEnd → session stop --if-open",
      "  hook     SessionStart → session start --passive",
      "  hook     UserPromptSubmit → session intent --from-prompt",
    ]);
  });

  it("prints one hook when passive capture was turned off", () => {
    // Which hooks are registered is the whole difference between the two
    // arrangements, so it is listed rather than counted.
    expect(formatHook({ ...result, hooks: [STOP_HOOK] })).toEqual([
      "  wrote    /Users/dev/.claude/settings.json",
      "  hook     SessionEnd → session stop --if-open",
    ]);
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
      "  hook     PreToolUse (Edit|Write|MultiEdit|Bash) → session hook check",
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
