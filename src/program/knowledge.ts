import type { Command } from "commander";
import { readKnowledge, writeKnowledge, parseKnowledgeLimit } from "../commands/knowledge.js";
import { openInBrowser, parseDays } from "../commands/week.js";
import { knowledgeJson } from "../knowledge.js";
import type { ProgramOptions } from "./options.js";

type Flags = { days: string; limit: string; path?: string; session?: string; out?: string; open?: boolean };
function inputs(flags: Flags, options: ProgramOptions) {
  return { ...options, days: parseDays(flags.days), limit: parseKnowledgeLimit(flags.limit), path: flags.path, session: flags.session };
}
function common(command: Command): Command {
  return command.option("--days <n>", "how many days back to read", "30")
    .option("--limit <n>", "maximum most-recent matching sessions (1–1000)", "100")
    .option("--path <prefix>", "sessions that changed or declared this repository path")
    .option("--session <id>", "one session id or unambiguous prefix within the window");
}
export function registerKnowledge(program: Command, options: ProgramOptions): void {
  const knowledge = program.command("knowledge").description("Explore recorded session relationships and export agent context");
  common(knowledge.command("graph").description("Create an interactive local graph and compact JSON snapshot"))
    .option("--out <file.html>", "where to write the HTML; JSON is written beside it")
    .option("--no-open", "write the artifacts without opening a browser")
    .action(async (flags: Flags) => {
      const graph = await readKnowledge(inputs(flags, options));
      const files = await writeKnowledge(graph, { out: flags.out, tmp: options.tmp });
      const counts = graph.sessions.reduce((acc, s) => { acc[s[5]] = (acc[s[5]] ?? 0) + 1; return acc; }, {} as Record<string, number>);
      console.log(`  ${graph.sessions.length} sessions · ${counts.merged ?? 0} landed · ${counts.abandoned ?? 0} abandoned · ${counts.open ?? 0} open · ${counts.empty ?? 0} empty`);
      if (graph.snapshot.omitted) console.log(`  ${graph.snapshot.omitted} older matching sessions omitted by --limit.`);
      console.log(`  graph    ${files.html}`);
      console.log(`  context  ${files.json}`);
      if (flags.open !== false) await openInBrowser(files.html, options);
    });
  common(knowledge.command("context").description("Print compact, self-describing JSON for any agent to read"))
    .action(async (flags: Flags) => { console.log(knowledgeJson(await readKnowledge(inputs(flags, options)))); });
}
