import { SUITS, type Card, type Suit } from "./game-api";

const SUIT_ORDER: ReadonlyMap<Suit, number> = new Map(
  SUITS.map((suit, index) => [suit, index]),
);

const RANK_ORDER: ReadonlyMap<Card["rank"], number> = new Map(
  (["7", "8", "9", "10", "J", "Q", "K", "A"] as const)
    .map((rank, index) => [rank, index]),
);

/** Returns a display-sorted copy without changing the hand or its cards. */
export function sortCardsForDisplay(cards: readonly Card[]): Card[] {
  return [...cards].sort((left, right) => {
    const suitDifference = SUIT_ORDER.get(left.suit)! - SUIT_ORDER.get(right.suit)!;
    return suitDifference || RANK_ORDER.get(left.rank)! - RANK_ORDER.get(right.rank)!;
  });
}
