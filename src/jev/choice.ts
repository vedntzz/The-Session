import { requestSystemOne } from "./client.js";

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function chosenAnswer(value: unknown, criteria: Readonly<Record<string, string | null>>) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  if (answer.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)) return null;
  if (!probability(answer.confidence) || typeof answer.probabilities !== "object" || answer.probabilities === null) return null;
  const probabilities = answer.probabilities as Record<string, unknown>;
  if (Array.isArray(probabilities) || Object.keys(probabilities).length !== Object.keys(criteria).length) return null;
  const values = Object.keys(criteria).map((key) => Object.hasOwn(probabilities, key) ? probabilities[key] : undefined);
  if (!values.every(probability) || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-6) return null;
  const confidence = probabilities[answer.choice];
  return probability(confidence) ? { label: answer.choice, confidence } : null;
}

export async function requestChoice(intent: string, files: readonly string[], instructions: string, criteria: Readonly<Record<string, string | null>>, timeoutMs = 1000) {
  const questions = { choice: { type: "choice", instructions, criteria } };
  const answers = await requestSystemOne(intent, files, questions, timeoutMs);
  return chosenAnswer(answers?.choice, criteria);
}
