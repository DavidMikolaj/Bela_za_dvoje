import { describe, expect, it } from "vitest";
import { createDeck } from "../src/game/cards.js";
import { dealGame, playCard } from "../src/game/game-engine.js";
import type { Card, Declaration } from "../src/game/types.js";

const card = (id: string, rank: Card["rank"]): Card => ({ id, rank, suit: "srce" });

describe("failed adut contract point transfer", () => {
  it("awards all match points to Player 1 after taking every trick, including Player 2's declaration", () => {
    const dealt = dealGame(createDeck());
    const declarationCard = card("player2-zvanje-7", "7");
    const declaration: Declaration = {
      kind: "sequence", points: 20,
      cards: [declarationCard, card("player2-zvanje-8", "8"), card("player2-zvanje-9", "9")],
      sequenceLength: 3, highestRank: "9", rank: null,
    };
    let state = {
      ...dealt,
      phase: "playing" as const,
      currentBidder: null,
      currentPlayer: "player1" as const,
      players: {
        player1: { initialCards: [card("last-trick-j", "J")], additionalCards: [] },
        player2: { initialCards: [card("last-trick-7", "7")], additionalCards: [] },
      },
      bidding: { turn: 1 as const, selectedSuit: "srce" as const, selectedBy: "player2" as const },
      tricksPlayed: 9,
      currentTrick: { number: 10, cards: [], ledSuit: null, winner: null },
      tricksWon: { player1: 9, player2: 0 },
      trickPoints: { player1: 150, player2: 0 },
      declarationComparisonResult: {
        winner: "player2" as const,
        pointsAwarded: { player1: 0, player2: 20 },
        scoredByPlayer: { player1: [], player2: [declaration] },
      },
    };

    state = playCard(state, "player1", "last-trick-j");
    state = playCard(state, "player2", "last-trick-7");

    expect(state.roundScore?.contractSucceeded).toBe(false);
    expect(state.roundScore?.declarationPoints).toEqual({ player1: 0, player2: 20 });
    expect(state.roundScore?.roundTotals).toEqual({ player1: 270, player2: 20 });
    expect(state.roundScore?.matchPointsAwarded).toEqual({ player1: 290, player2: 0 });
    expect(state.matchScores).toEqual({ player1: 290, player2: 0 });
  });
});
