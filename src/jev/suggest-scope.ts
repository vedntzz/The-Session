import { requestJev } from "./client.js";
import type { ScopeSuggestion, SuggestScopeInput, SuggestScopeOutput } from "./interface.js";

function isValidSuggestion(value: unknown): value is ScopeSuggestion {
  return typeof value === "object" && value !== null
    && "path" in value && typeof value.path === "string"
    && "confidence" in value && typeof value.confidence === "number"
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
    && "reason" in value && typeof value.reason === "string"
    && value.reason.trim().length > 0 && value.reason.length <= 200;
}

export async function suggestScope(input: SuggestScopeInput): Promise<SuggestScopeOutput> {
  const response = await requestJev("scope", input.intent, input.candidatePaths);
  if (!Array.isArray(response)) return [];
  const candidates = new Set(input.candidatePaths);
  const unique = new Map<string, ScopeSuggestion>();
  for (const suggestion of response) {
    if (!isValidSuggestion(suggestion) || !candidates.has(suggestion.path)) continue;
    const previous = unique.get(suggestion.path);
    if (!previous || suggestion.confidence > previous.confidence) {
      const { path, confidence, reason } = suggestion;
      unique.set(path, { path, confidence, reason });
    }
  }
  return [...unique.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}
