import { requestJev } from "./client.js";
import type { FlagWriteInput, FlagWriteOutput } from "./interface.js";

export async function flagWrite(input: FlagWriteInput): Promise<FlagWriteOutput> {
  const response = await requestJev("flag", input.intent, [input.attemptedPath, ...input.agreedPaths], 300);
  if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
  if (!("label" in response) || !("confidence" in response)) return null;
  const { label, confidence } = response;
  if (label !== "related" && label !== "unrelated" && label !== "unsure") return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { label, confidence };
}
