import { requestSystemOne } from "./client.js";
import type { ScopeSuggestion, SuggestScopeInput } from "./interface.js";

function decodeAnswers(answers: Record<string, unknown> | null, paths: readonly string[], offset: number): ScopeSuggestion[] | null {
  if (!answers) return null;
  const suggestions: ScopeSuggestion[] = [];
  for (const [index, path] of paths.entries()) {
    const answer = answers[`q${offset + index}`];
    if (typeof answer !== "object" || answer === null || !("type" in answer) || answer.type !== "noul" || !("noul" in answer)) return null;
    const confidence = answer.noul;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    suggestions.push({ path, confidence, reason: "noul" });
  }
  return suggestions;
}

async function requestBatch(input: SuggestScopeInput, offset: number) {
  const paths = input.candidatePaths.slice(offset, offset + 200);
  const questions = Object.fromEntries(paths.map((path, index) => [`q${offset + index}`, {
    type: "noul", instructions: `Will the work in \`intent\` edit ${path}?`,
  }]));
  const answers = await requestSystemOne(input.intent, input.candidatePaths, questions);
  return decodeAnswers(answers, paths, offset);
}

export async function requestScope(input: SuggestScopeInput): Promise<ScopeSuggestion[] | null> {
  const batches = Array.from({ length: Math.ceil(input.candidatePaths.length / 200) }, (_, index) => requestBatch(input, index * 200));
  const results = await Promise.all(batches);
  return results.some((result) => result === null) ? null : results.flatMap((result) => result ?? []);
}
