import type { Card, Rank, Suit } from "./types.js";
import { SUITS } from "./types.js";

export const RANKS: readonly Rank[] = ["7", "8", "9", "10", "J", "Q", "K", "A"];

/** Card definitions contain no presentation or artwork data. */
export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })),
  );
}
