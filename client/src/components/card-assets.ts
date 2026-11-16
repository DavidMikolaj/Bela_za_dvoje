import type { Card, Suit } from "../game-api";

const SOURCE_SUIT: Readonly<Record<Suit, string>> = {
  srce: "heart",
  tikva: "bell",
  žir: "acorn",
  zelje: "leaf",
};

// In the provided deck, Unter corresponds to our J and Ober corresponds to our Q.
const SOURCE_RANK: Readonly<Record<Card["rank"], string>> = {
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
  J: "unter",
  Q: "ober",
  K: "king",
  A: "ace",
};

export function getPlayingCardAssetPath(card: Card): string {
  return `/cards/${SOURCE_SUIT[card.suit]}-${SOURCE_RANK[card.rank]}.png`;
}

export function getSuitIconAssetPath(suit: Suit): string {
  return `/cards/suits/${SOURCE_SUIT[suit]}-icon@medium.png`;
}

export const CARD_BACK_ASSET_PATH = "/cards/back.png";
