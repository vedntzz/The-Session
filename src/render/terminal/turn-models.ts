// The model each turn ran on, and imported history set aside, as `week <id>` prints them.
import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { INDENT, label, plural } from "./text.js";

/** Consecutive turns on one model collapsed, in order: `a, b ×2`; a turn naming none reads `unnamed`. */
export function modelRuns(models: readonly (string | null)[]): string {
  const runs: { model: string; count: number }[] = [];
  for (const model of models.map((named) => named ?? "unnamed")) {
    const last = runs.at(-1);
    if (last?.model === model) last.count += 1;
    else runs.push({ model, count: 1 });
  }
  return runs.map(({ model, count }) => (count === 1 ? model : `${model} ×${count}`)).join(", ");
}

/** The two facts, or nothing for either the record does not carry. */
function facts(session: Session): { models?: string; imports?: string } {
  const models = session.cost.turnModels;
  const skipped = session.cost.importedTurnsSkipped ?? 0;
  return {
    ...(models !== undefined && models.length > 0 ? { models: modelRuns(models) } : {}),
    ...(skipped > 0 ? { imports: `${plural(skipped, "imported turn", "imported turns")} skipped, not counted` } : {}),
  };
}

/** The brief view's line under the figures: which models the turns ran on, and what was set aside. */
export function turnModelNote(session: Session, palette: Palette): string[] {
  const { models, imports } = facts(session);
  const parts = [models === undefined ? undefined : `turns ran on ${models}`, imports].filter((part) => part !== undefined);
  return parts.length === 0 ? [] : [`${INDENT}${palette.meta(parts.join(" · "))}`];
}

/** The labelled view's rows for the same two facts. */
export function turnModelRows(session: Session, palette: Palette): string[] {
  const { models, imports } = facts(session);
  return [
    ...(models === undefined ? [] : [`${INDENT}${palette.meta(label("models"))}${models}`]),
    ...(imports === undefined ? [] : [`${INDENT}${palette.meta(label("imported"))}${imports}`]),
  ];
}
