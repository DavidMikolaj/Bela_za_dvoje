import { describe, expect, it } from "vitest";
import { sortCardsForDisplay } from "../src/card-sorting";
import type { Card, Suit } from "../src/game-api";

function card(suit: Suit, rank: Card["rank"]): Card {
  return { id: `${suit}-${rank}`, suit, rank };
}

describe("sortCardsForDisplay", () => {
  it("groups Mađarice suits in the required order", () => {
    const cards = [
      card("zelje", "A"),
      card("žir", "8"),
      card("tikva", "K"),
      card("srce", "10"),
      card("žir", "7"),
      card("tikva", "7"),
      card("srce", "7"),
    ];

    expect(sortCardsForDisplay(cards).map(({ suit }) => suit)).toEqual([
      "srce", "srce", "tikva", "tikva", "žir", "žir", "zelje",
    ]);
  });

  it("sorts ranks ascending within each suit", () => {
    const cards = ["A", "10", "7", "J", "9", "Q", "8", "K"].map((rank) =>
      card("srce", rank as Card["rank"]),
    );

    expect(sortCardsForDisplay(cards).map(({ rank }) => rank)).toEqual([
      "7", "8", "9", "10", "J", "Q", "K", "A",
    ]);
  });

  it("sorts a mixed-suit hand, preserves card identifiers, and does not mutate its input", () => {
    const hand = [
      card("zelje", "8"),
      card("srce", "A"),
      card("tikva", "10"),
      card("srce", "7"),
      card("žir", "Q"),
      card("tikva", "7"),
    ];
    const originalOrder = [...hand];
    const sorted = sortCardsForDisplay(hand);

    expect(sorted).not.toBe(hand);
    expect(hand).toEqual(originalOrder);
    expect(sorted.map(({ id }) => id)).toEqual([
      "srce-7", "srce-A", "tikva-7", "tikva-10", "žir-Q", "zelje-8",
    ]);
    expect(sorted.every((sortedCard) => hand.includes(sortedCard))).toBe(true);
  });
});
