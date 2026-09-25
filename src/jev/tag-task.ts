import { requestChoice } from "./choice.js";
import type { TagTaskInput, TaskType } from "./interface.js";

// Advisory only; call after the session has finished.
export async function tagTask(input: TagTaskInput): Promise<TaskType | null> {
  const result = await requestChoice(input.intent, input.changedPaths,
    "Which task type describes the work in `intent`, considering the changed paths in `files`?",
    { feature: null, fix: null, refactor: null, test: null, docs: null, chore: null });
  const label = result?.label;
  if (label === "feature" || label === "fix" || label === "refactor"
    || label === "test" || label === "docs" || label === "chore") return label;
  return null;
}
