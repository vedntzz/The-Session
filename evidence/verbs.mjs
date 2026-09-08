// The command surface, read from the real commander tree rather than from the
// help text, which is a filtered view of it. Used by docs/context.md.
import { buildProgram } from "/Users/vedant/dev-session/dist/program.js";

const walk = (cmd, prefix = "") =>
  cmd.commands.flatMap((c) => {
    const name = (prefix ? prefix + " " : "") + c.name();
    const args = c.registeredArguments
      .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
      .join(" ");
    const signature = `${name}${args ? " " + args : ""}`;
    const lines = [`${signature.padEnd(26)}${c.description()}`];
    const opts = c.options.map((o) => o.flags).join("  ");
    if (opts) {
      lines.push(`${" ".repeat(26)}${opts}`);
    }
    return [...lines, ...walk(c, name)];
  });

const program = buildProgram();
const rows = walk(program);
console.log(`top-level verbs:        ${program.commands.length}`);
console.log(`including subcommands:  ${program.commands.flatMap((c) => [c, ...c.commands]).length}`);
console.log();
console.log(rows.join("\n"));
