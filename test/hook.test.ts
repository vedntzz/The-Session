import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasHook,
  HOOK_COMMAND,
  HOOK_EVENT,
  HOOK_TIMEOUT,
  withHook,
  withoutHook,
  type Settings,
} from "../src/capture/hook.js";
import {
  formatHook,
  installHook,
  settingsFile,
  uninstallHook,
  type HookResult,
} from "../src/commands/hook.js";

/** The group `withHook` writes, as it appears in a settings file. */
const OURS = {
  hooks: [{ type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT }],
};
/** The group a `session` from before the timeout wrote. */
const STALE = { hooks: [{ type: "command", command: HOOK_COMMAND }] };
/** Somebody else's SessionEnd hook, which must survive both operations. */
const THEIRS = { hooks: [{ type: "command", command: "say goodbye" }] };

describe("the hook it registers", () => {
  it("is a SessionEnd hook", () => {
    expect(HOOK_EVENT).toBe("SessionEnd");
  });

  it("closes an open session and stays quiet when there is none", () => {
    // The hook fires for every Claude Code session, declared or not.
    expect(HOOK_COMMAND).toBe("session stop --if-open");
  });

  it("asks for longer than the 1.5 seconds SessionEnd hooks get by default", () => {
    // git plus the whole transcript does not reliably fit in the default
    // budget, and a cancelled hook leaves the session open forever.
    expect(HOOK_TIMEOUT).toBeGreaterThan(1.5);
    // Claude Code raises the shared budget to match, but only up to 60.
    expect(HOOK_TIMEOUT).toBeLessThanOrEqual(60);
  });

  it("registers no matcher, so every ending is recorded", () => {
    // SessionEnd matches on why the session ended; omitting the key means all
    // of them. A `/clear` is as much an ending as closing the window.
    const groups = (withHook({})["hooks"] as Record<string, unknown>)[HOOK_EVENT] as Record<
      string,
      unknown
    >[];

    expect(groups).toHaveLength(1);
    expect("matcher" in (groups[0] as Record<string, unknown>)).toBe(false);
  });

  it("nests the handler inside a matcher group, as the settings schema wants", () => {
    expect(withHook({})).toEqual({ hooks: { [HOOK_EVENT]: [OURS] } });
  });
});

describe("hasHook", () => {
  it("finds the hook once it is registered", () => {
    expect(hasHook({ hooks: { [HOOK_EVENT]: [OURS] } })).toBe(true);
  });

  it("is false for settings with no hooks at all", () => {
    expect(hasHook({})).toBe(false);
    expect(hasHook({ model: "opus" })).toBe(false);
  });

  it("is false when someone else's hook is the only one there", () => {
    expect(hasHook({ hooks: { [HOOK_EVENT]: [THEIRS] } })).toBe(false);
  });

  it("is false when the hook is registered on a different event", () => {
    expect(hasHook({ hooks: { SessionStart: [OURS] } })).toBe(false);
  });

  it("is false for an entry left by a session that wrote no timeout", () => {
    expect(hasHook({ hooks: { [HOOK_EVENT]: [STALE] } })).toBe(false);
  });

  it("reads a malformed hooks section as no hook, rather than throwing", () => {
    expect(hasHook({ hooks: "nonsense" })).toBe(false);
    expect(hasHook({ hooks: { [HOOK_EVENT]: "nonsense" } })).toBe(false);
  });
});

describe("withHook", () => {
  it("registers the hook in settings that had none", () => {
    expect(withHook({})).toEqual({ hooks: { [HOOK_EVENT]: [OURS] } });
  });

  it("repairs an entry that was registered without a timeout", () => {
    expect(withHook({ hooks: { [HOOK_EVENT]: [STALE] } })).toEqual({
      hooks: { [HOOK_EVENT]: [OURS] },
    });
  });

  it("repairs that entry in place rather than adding a second one", () => {
    const next = withHook({ hooks: { [HOOK_EVENT]: [THEIRS, STALE] } });

    // Two hooks both closing the session would double-count the work.
    expect(next).toEqual({ hooks: { [HOOK_EVENT]: [THEIRS, OURS] } });
  });

  it("registers it once, however many times it is asked", () => {
    const once = withHook({});
    expect(withHook(once)).toEqual(once);
    expect(withHook(withHook(once))).toEqual(once);
  });

  it("leaves every other setting alone", () => {
    const settings: Settings = { model: "opus", theme: "dark", tui: { compact: true } };
    const next = withHook(settings);

    expect(next["model"]).toBe("opus");
    expect(next["theme"]).toBe("dark");
    expect(next["tui"]).toEqual({ compact: true });
  });

  it("keeps other SessionEnd hooks, and adds itself after them", () => {
    const next = withHook({ hooks: { [HOOK_EVENT]: [THEIRS] } });

    expect(next).toEqual({ hooks: { [HOOK_EVENT]: [THEIRS, OURS] } });
  });

  it("keeps hooks registered on other events", () => {
    const next = withHook({ hooks: { PreToolUse: [THEIRS] } });

    expect(next).toEqual({ hooks: { PreToolUse: [THEIRS], [HOOK_EVENT]: [OURS] } });
  });

  it("does not touch what it was given", () => {
    const settings: Settings = { hooks: { [HOOK_EVENT]: [THEIRS] } };
    const before = structuredClone(settings);

    withHook(settings);

    expect(settings).toEqual(before);
  });

  it("refuses to overwrite a hooks section that is not an object", () => {
    expect(() => withHook({ hooks: "nonsense" })).toThrow(/is not an object/);
  });

  it("refuses to overwrite a SessionEnd section that is not a list", () => {
    expect(() => withHook({ hooks: { [HOOK_EVENT]: { nope: true } } })).toThrow(/is not a list/);
  });
});

describe("withoutHook", () => {
  it("takes the hook back out", () => {
    expect(withoutHook(withHook({}))).toEqual({});
  });

  it("prunes the containers it created, and nothing more", () => {
    const next = withoutHook(withHook({ model: "opus" }));

    expect(next).toEqual({ model: "opus" });
    expect("hooks" in next).toBe(false);
  });

  it("leaves other SessionEnd hooks registered", () => {
    const next = withoutHook({ hooks: { [HOOK_EVENT]: [THEIRS, OURS] } });

    expect(next).toEqual({ hooks: { [HOOK_EVENT]: [THEIRS] } });
  });

  it("leaves other events registered", () => {
    const next = withoutHook({ hooks: { PreToolUse: [THEIRS], [HOOK_EVENT]: [OURS] } });

    expect(next).toEqual({ hooks: { PreToolUse: [THEIRS] } });
  });

  it("takes only its own entry out of a group it shares", () => {
    const shared = {
      hooks: [
        { type: "command", command: "say goodbye" },
        { type: "command", command: HOOK_COMMAND },
      ],
    };

    expect(withoutHook({ hooks: { [HOOK_EVENT]: [shared] } })).toEqual({
      hooks: { [HOOK_EVENT]: [{ hooks: [{ type: "command", command: "say goodbye" }] }] },
    });
  });

  it("is a no-op on settings that never had it", () => {
    expect(withoutHook({ model: "opus" })).toEqual({ model: "opus" });
    expect(withoutHook({})).toEqual({});
  });

  it("does not touch what it was given", () => {
    const settings: Settings = { hooks: { [HOOK_EVENT]: [OURS] } };
    const before = structuredClone(settings);

    withoutHook(settings);

    expect(settings).toEqual(before);
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

  it("registers the hook in the settings file", async () => {
    await write({ model: "opus" });

    const result = await installHook({ settings: file });

    expect(result).toEqual({
      file,
      event: HOOK_EVENT,
      command: HOOK_COMMAND,
      changed: true,
      action: "installed",
    });
    await expect(read()).resolves.toEqual({ model: "opus", hooks: { [HOOK_EVENT]: [OURS] } });
  });

  it("writes JSON a person can read, and ends the file with a newline", async () => {
    await write({});

    await installHook({ settings: file });

    const text = await readFile(file, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "hooks": {');
  });

  it("upgrades a hook an older session installed, and says it changed", async () => {
    await write({ hooks: { [HOOK_EVENT]: [STALE] } });

    const result = await installHook({ settings: file });

    expect(result.changed).toBe(true);
    await expect(read()).resolves.toEqual({ hooks: { [HOOK_EVENT]: [OURS] } });
  });

  it("says it changed nothing when the hook is already registered", async () => {
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

    await expect(read()).resolves.toEqual({ hooks: { [HOOK_EVENT]: [OURS] } });
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

  it("takes the hook back out of the settings file", async () => {
    await writeFile(file, JSON.stringify({ model: "opus" }), "utf8");
    await installHook({ settings: file });

    const result = await uninstallHook({ settings: file });

    expect(result.changed).toBe(true);
    expect(result.action).toBe("removed");
    await expect(readFile(file, "utf8")).resolves.toBe('{\n  "model": "opus"\n}\n');
  });

  it("says it changed nothing when the hook was never registered", async () => {
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
    event: HOOK_EVENT,
    command: HOOK_COMMAND,
    changed: true,
    action: "installed",
  };

  it("prints what it wrote and where", () => {
    expect(formatHook(result)).toEqual([
      "  wrote    /Users/dev/.claude/settings.json",
      "  hook     SessionEnd → session stop --if-open",
    ]);
  });

  it("says when the hook was already there", () => {
    expect(formatHook({ ...result, changed: false })[0]).toBe(
      "  already  /Users/dev/.claude/settings.json",
    );
  });

  it("says when it removed the hook", () => {
    expect(formatHook({ ...result, action: "removed" })[0]).toBe(
      "  removed  /Users/dev/.claude/settings.json",
    );
  });

  it("says when there was no hook to remove", () => {
    expect(formatHook({ ...result, action: "removed", changed: false })[0]).toBe(
      "  not set  /Users/dev/.claude/settings.json",
    );
  });

  it("lines the two labels up in one column", () => {
    const [first, second] = formatHook(result);

    expect(first.indexOf("/Users")).toBe(second.indexOf("SessionEnd"));
  });
});
