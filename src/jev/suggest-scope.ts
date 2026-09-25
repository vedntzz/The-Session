import { requestScope } from "./scope-answers.js";
import type { SuggestScopeInput, SuggestScopeOutput } from "./interface.js";

export async function suggestScope(input: SuggestScopeInput): Promise<SuggestScopeOutput> {
  const response = await requestScope(input);
  if (response === null) return [];
  const candidates = new Set(input.candidatePaths);
  const unique = new Map<string, SuggestScopeOutput[number]>();
  for (const suggestion of response) {
    if (!candidates.has(suggestion.path)) continue;
    const previous = unique.get(suggestion.path);
    if (!previous || suggestion.confidence > previous.confidence) {
      const { path, confidence, reason } = suggestion;
      unique.set(path, { path, confidence, reason });
    }
  }
  return [...unique.values()]
    .sort((a, b) => b.confidence - a.confidence || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, 10);
}
