import { requestJev } from "./client.js";
import type { TagTaskInput, TaskType } from "./interface.js";

// Advisory only; call after the session has finished.
export async function tagTask(input: TagTaskInput): Promise<TaskType | null> {
  const response = await requestJev("tag", input.intent, input.changedPaths);
  if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
  if (!("label" in response) || !("confidence" in response)) return null;
  const { label, confidence } = response;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (label === "feature" || label === "fix" || label === "refactor"
    || label === "test" || label === "docs" || label === "chore") return label;
  return null;
}
