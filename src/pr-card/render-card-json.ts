// `session pr --json`: the card's data for CI and other tools. Pure.
import type { CardData } from "./card-data.js";

/** The JSON shape's version; bumped when a field changes meaning or goes away. */
export const CARD_JSON_SCHEMA = 1;

/** The card as JSON; no matching session is record false and card null, never an empty card. */
export function renderCardJson(card: CardData | null): string {
  return JSON.stringify({ schema: CARD_JSON_SCHEMA, record: card !== null, card }, null, 2);
}
