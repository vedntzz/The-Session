import { requestChoice } from "./choice.js";
import type { FlagWriteInput, FlagWriteOutput } from "./interface.js";

export async function flagWrite(input: FlagWriteInput): Promise<FlagWriteOutput> {
  const result = await requestChoice(input.intent, [input.attemptedPath, ...input.agreedPaths],
    "How is the attempted edit in `files[0]` related to the work in `intent`, considering the agreed paths in the rest of `files`?",
    { related: "Related to the declared work", unrelated: "Unrelated to the declared work", unsure: "Insufficient information" }, 300);
  if (!result || (result.label !== "related" && result.label !== "unrelated" && result.label !== "unsure")) return null;
  return { label: result.label, confidence: result.confidence };
}
