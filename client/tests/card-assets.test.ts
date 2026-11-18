import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPlayingCardAssetPath, getSuitIconAssetPath, CARD_BACK_ASSET_PATH } from "../src/components/card-assets";
import { SUITS, type Card } from "../src/game-api";
type Rank = Card["rank"];

const deck: Card[] = SUITS.flatMap((suit) => (["7", "8", "9", "10", "J", "Q", "K", "A"] as const)
  .map((rank: Rank) => ({ id: `${suit}-${rank}`, suit, rank })));

describe("Mađarice card asset mapping", () => {
  it("maps all 32 game cards to unique existing face images", () => {
    const assets = deck.map(getPlayingCardAssetPath);
    expect(assets).toHaveLength(32);
    expect(new Set(assets).size).toBe(32);
    for (const asset of assets) expect(existsSync(resolve(process.cwd(), "client/public", asset.slice(1)))).toBe(true);
  });

  it("maps J to Unter and Q to Ober in the supplied card-face filenames", () => {
    expect(getPlayingCardAssetPath(deck.find(({ suit, rank }) => suit === "srce" && rank === "J")!)).toBe("/cards/heart-unter.png");
    expect(getPlayingCardAssetPath(deck.find(({ suit, rank }) => suit === "srce" && rank === "Q")!)).toBe("/cards/heart-ober.png");
  });

  it("maps the two Bela cards to their Mađarice face images", () => {
    const king = deck.find(({ suit, rank }) => suit === "srce" && rank === "K")!;
    const queen = deck.find(({ suit, rank }) => suit === "srce" && rank === "Q")!;
    expect(getPlayingCardAssetPath(king)).toBe("/cards/heart-king.png");
    expect(getPlayingCardAssetPath(queen)).toBe("/cards/heart-ober.png");
  });

  it("maps all suit icons and the card back to existing images", () => {
    expect(SUITS.map(getSuitIconAssetPath)).toEqual([
      "/cards/suits/heart-icon@medium.png",
      "/cards/suits/bell-icon@medium.png",
      "/cards/suits/acorn-icon@medium.png",
      "/cards/suits/leaf-icon@medium.png",
    ]);
    for (const suit of SUITS) expect(existsSync(resolve(process.cwd(), "client/public", getSuitIconAssetPath(suit).slice(1)))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "client/public", CARD_BACK_ASSET_PATH.slice(1)))).toBe(true);
  });
});
