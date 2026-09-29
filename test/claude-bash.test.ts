import { describe, expect, it } from "vitest";
import { parseClaudeBash } from "../src/capture/adapters/claude-bash.js";
import { MAX_WRITE_PAYLOAD_BYTES } from "../src/capture/adapters/claude-write.js";

/**
 * A Bash PreToolUse payload, read on its own.
 *
 * Through the Claude adapter the file-tool parser sees every payload first,
 * so a payload too large or not JSON never reaches this one. It is still the
 * whole of what stands between a shell command and the recognisers, and a
 * junk payload read as a command — or a command read as junk — is the check
 * answering a question it was never asked. Every rejection is named here.
 */

function payload(over: Record<string, unknown> = {}, input: unknown = { command: "rm src/a" }): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    cwd: "/work",
    tool_input: input,
    ...over,
  });
}

describe("parseClaudeBash", () => {
  it("reads the command and where it runs", () => {
    expect(parseClaudeBash(payload())).toEqual({
      kind: "shell",
      tool: "Bash",
      request: { cwd: "/work", command: "rm src/a" },
    });
  });

  it("ignores the fields that do not change what a command writes", () => {
    const parsed = parseClaudeBash(
      payload({}, { command: "rm src/a", description: "tidy", timeout: 5000, run_in_background: true }),
    );
    expect(parsed).toEqual({ kind: "shell", tool: "Bash", request: { cwd: "/work", command: "rm src/a" } });
  });

  it("keeps an empty command, for the recognisers to call unknown", () => {
    expect(parseClaudeBash(payload({}, { command: "" }))).toMatchObject({ kind: "shell", request: { command: "" } });
  });

  it("calls another tool unsupported, not invalid", () => {
    expect(parseClaudeBash(payload({ tool_name: "Read" }))).toEqual({ kind: "unsupported" });
    expect(parseClaudeBash(payload({ tool_name: "bash" }))).toEqual({ kind: "unsupported" });
  });

  describe("refuses", () => {
    it("a payload over the size limit, counted in bytes rather than characters", () => {
      const room = MAX_WRITE_PAYLOAD_BYTES - Buffer.byteLength(payload({}, { command: "" }), "utf8");
      expect(parseClaudeBash(payload({}, { command: "a".repeat(room) })).kind).toBe("shell");
      expect(parseClaudeBash(payload({}, { command: "a".repeat(room + 1) }))).toEqual({
        kind: "invalid",
        reason: "payload-too-large",
      });
      // Three bytes each: a third as many characters is already over.
      expect(parseClaudeBash(payload({}, { command: "日".repeat(Math.ceil(room / 3) + 1) }))).toEqual({
        kind: "invalid",
        reason: "payload-too-large",
      });
    });

    it.each(["", "not json", "{", '{"hook_event_name":"PreToolUse",}'])("text that is not JSON: %j", (text) => {
      expect(parseClaudeBash(text)).toEqual({ kind: "invalid", reason: "invalid-json" });
    });

    it.each([
      ["null", "null"],
      ["an array", "[]"],
      ["a string", '"PreToolUse"'],
      ["another event", payload({ hook_event_name: "PostToolUse" })],
      ["no event", payload({ hook_event_name: undefined })],
      ["no tool name", payload({ tool_name: undefined })],
      ["a tool name that is not a string", payload({ tool_name: ["Bash"] })],
    ])("something that is not a PreToolUse event: %s", (_name, text) => {
      expect(parseClaudeBash(text)).toEqual({ kind: "invalid", reason: "invalid-event" });
    });

    it.each([
      ["no cwd", payload({ cwd: undefined })],
      ["an empty cwd", payload({ cwd: "" })],
      ["a cwd that is not a string", payload({ cwd: 7 })],
      ["no tool_input", payload({ tool_input: undefined })],
      ["a tool_input that is an array", payload({}, ["rm src/a"])],
      ["a tool_input that is a string", payload({}, "rm src/a")],
      ["no command", payload({}, { description: "tidy" })],
      ["a command that is not a string", payload({}, { command: ["rm", "src/a"] })],
    ])("a Bash call it cannot read a command from: %s", (_name, text) => {
      expect(parseClaudeBash(text)).toEqual({ kind: "invalid", reason: "invalid-input" });
    });
  });

  it("never carries the command into a rejection", () => {
    const secret = "cat .env > /tmp/leak";
    for (const text of [payload({ cwd: "" }, { command: secret }), payload({ hook_event_name: "x" }, { command: secret })]) {
      expect(JSON.stringify(parseClaudeBash(text))).not.toContain(secret);
    }
  });
});
