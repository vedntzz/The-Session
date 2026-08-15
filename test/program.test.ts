import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";

/** Runs a subcommand and returns everything it wrote to stdout via console.log. */
async function run(...argv: string[]): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const program = buildProgram().exitOverride();
  await program.parseAsync(argv, { from: "user" });
  return log.mock.calls.map((call) => String(call[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session", () => {
  it.each(["start", "stop", "show", "week"])("%s prints not implemented", async (name) => {
    await expect(run(name)).resolves.toEqual(["not implemented"]);
  });

  it("registers exactly the four subcommands", () => {
    const names = buildProgram()
      .commands.map((command) => command.name())
      .sort();
    expect(names).toEqual(["show", "start", "stop", "week"]);
  });

  it("rejects an unknown subcommand", async () => {
    const program = buildProgram().exitOverride();
    program.configureOutput({ writeErr: () => {} });
    await expect(program.parseAsync(["nope"], { from: "user" })).rejects.toThrow();
  });
});
