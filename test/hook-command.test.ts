import { describe, expect, it } from "vitest";
import {
  CHECK_HOOK, OPEN_HOOK, STOP_HOOK, commandLine, commandOf, hasEntry,
  hasHooks, launcherLine, wantedHooks, withHooks, withoutHooks,
  type Settings,
} from "../src/capture/hook.js";

const launcher = { node: "/opt/node", cli: "/opt/session/cli.js" };
const settingsFor = (command: string): Settings => ({
  hooks: { SessionStart: [{ hooks: [{ type: "command", command, timeout: 1 }] }] },
});

describe("hook commands retain their behavior when extracted", () => {
  it.each([
    [OPEN_HOOK, undefined, "session start --passive"],
    [OPEN_HOOK, "codex", "session start --passive --agent codex"],
    [OPEN_HOOK, "claude-code", "session start --passive --agent claude-code"],
    [STOP_HOOK, "codex", "session stop --if-open"],
    [CHECK_HOOK, "codex", "session hook check"],
  ] as const)("formats command case %#", (hook, agent, expected) => {
    expect(commandOf(hook, agent)).toBe(expected);
    expect(commandLine(hook, launcher, agent)).toBe(
      `${launcherLine(launcher)} ${expected.slice("session ".length)}`,
    );
  });

  it.each([
    "session start --passive",
    " session\tstart  --passive ",
    "/old/bin/session start --passive",
    "/old/node /old/pkg/cli.js start --passive",
    "session start --passive --agent claude-code",
    "session start --passive --agent codex",
  ])("repairs and removes the recognized command: %s", (command) => {
    const original = settingsFor(command);
    const snapshot = structuredClone(original);
    expect(hasEntry(original, OPEN_HOOK)).toBe(true);
    const updated = withHooks(original, wantedHooks(true), launcher, "codex");
    expect(hasHooks(updated, wantedHooks(true), launcher, "codex")).toBe(true);
    expect(withHooks(updated, wantedHooks(true), launcher, "codex")).toEqual(updated);
    expect(withoutHooks(original)).toEqual({});
    expect(original).toEqual(snapshot);
  });

  it.each([
    "session start --passive --extra",
    "session start --passive --agent",
    "session start --passive && echo other",
    '"session" start --passive',
    "'session start --passive",
    "wrapper session start --passive",
    "/opt/node /opt/other.js start --passive",
    "node cli.js start --passive",
  ])("leaves another command untouched: %s", (command) => {
    const settings = settingsFor(command);
    expect(hasEntry(settings, OPEN_HOOK)).toBe(false);
    expect(withoutHooks(settings)).toEqual(settings);
  });

  it("round-trips launcher paths containing spaces and apostrophes", () => {
    const quoted = { node: "/my tools/node", cli: "/it's here/cli.js" };
    expect(launcherLine(quoted)).toBe("'/my tools/node' '/it'\\''s here/cli.js'");
    const settings = settingsFor(commandLine(OPEN_HOOK, quoted, "codex"));
    expect(hasEntry(settings, OPEN_HOOK)).toBe(true);
    expect(withoutHooks(settings)).toEqual({});
  });
});
