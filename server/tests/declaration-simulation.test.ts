import { describe, expect, it } from "vitest";
import { createDeck } from "../src/game/cards.js";
import { dealGame, getPlayerView, submitBid } from "../src/game/game-engine.js";
import type { Card, Player } from "../src/game/types.js";

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seededShuffle(cards: readonly Card[], random: () => number): Card[] {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

const players: readonly Player[] = ["player1", "player2"];

describe("seeded declaration distribution audit", () => {
  it("simulates 100,000 valid deals and reports declaration frequencies by hand, seat, and dealer role", () => {
    const rounds = 100_000;
    const random = seededRandom(0xBE1A2026);
    const handStats = Object.fromEntries(players.map((player) => [player, { declarations: 0, awarded: 0, terca: 0, kvarta: 0, kvinta: 0, quads: 0 }])) as Record<Player, { declarations: number; awarded: number; terca: number; kvarta: number; kvinta: number; quads: number }>;
    const roleStats = { dealer: { hands: 0, declarations: 0, awarded: 0 }, nonDealer: { hands: 0, declarations: 0, awarded: 0 } };
    let declaredHands = 0;
    let roundsWithAward = 0;
    let totalAwardedPoints = 0;
    const suitCount = new Map<string, number>();
    const rankCount = new Map<string, number>();

    for (let round = 1; round <= rounds; round += 1) {
      const shuffled = seededShuffle(createDeck(), random);
      const deckIds = new Set(shuffled.map(({ id }) => id));
      expect(deckIds.size).toBe(32);
      const dealt = dealGame(shuffled, round);
      const state = submitBid(dealt, dealt.nonDealer, dealt.originalFaceUpCard.suit);
      const allHands = [state.players.player1, state.players.player2];
      const unique = new Set([...allHands.flatMap((hand) => [...hand.initialCards, ...hand.additionalCards]), state.faceUpCard, ...state.faceDownStack].map(({ id }) => id));
      expect(unique.size).toBe(32);
      expect(state.players.player1.initialCards.length + state.players.player1.additionalCards.length).toBe(10);
      expect(state.players.player2.initialCards.length + state.players.player2.additionalCards.length).toBe(10);

      let anyRoundDeclaration = false;
      let anyAward = false;
      for (const player of players) {
        const declarations = state.declarationsByPlayer[player].filter(({ points }) => points > 0);
        const awarded = state.declarationComparisonResult!.scoredByPlayer[player];
        const stats = handStats[player];
        if (declarations.length) {
          anyRoundDeclaration = true;
          stats.declarations += 1;
          declaredHands += 1;
        }
        if (awarded.length) {
          anyAward = true;
          stats.awarded += 1;
          totalAwardedPoints += state.declarationComparisonResult!.pointsAwarded[player];
        }
        for (const declaration of declarations) {
          if (declaration.kind === "sequence" && declaration.sequenceLength === 3) stats.terca += 1;
          if (declaration.kind === "sequence" && declaration.sequenceLength === 4) stats.kvarta += 1;
          if (declaration.kind === "sequence" && declaration.sequenceLength >= 5) stats.kvinta += 1;
          if (declaration.kind === "four-of-kind") stats.quads += 1;
          for (const card of declaration.cards) {
            suitCount.set(card.suit, (suitCount.get(card.suit) ?? 0) + 1);
            rankCount.set(card.rank, (rankCount.get(card.rank) ?? 0) + 1);
          }
        }
      }
      // Role and seat are both reported, while each round has one hand in each role.
      for (const player of players) {
        const hasDeclarations = state.declarationsByPlayer[player].some(({ points }) => points > 0);
        const hasAward = state.declarationComparisonResult!.scoredByPlayer[player].length > 0;
        const role = player === state.dealer ? roleStats.dealer : roleStats.nonDealer;
        role.hands += 1;
        if (hasDeclarations) role.declarations += 1;
        if (hasAward) role.awarded += 1;
      }
      if (anyAward) roundsWithAward += 1;

      const p1View = getPlayerView(state, "player1");
      const p2View = getPlayerView(state, "player2");
      expect(p1View.hands.player2.cards).toEqual([]);
      expect(p2View.hands.player1.cards).toEqual([]);
      expect(p1View.awardedZvanja.player1).toEqual(p2View.awardedZvanja.player1);
      expect(p1View.awardedZvanja.player2).toEqual(p2View.awardedZvanja.player2);
    }

    const percentage = (count: number, total: number) => Number((100 * count / total).toFixed(3));
    const summary = {
      seed: "0xBE1A2026",
      rounds,
      hands: Object.fromEntries(players.map((player) => [player, {
        anyDeclarationPercent: percentage(handStats[player].declarations, rounds),
        awardedPercent: percentage(handStats[player].awarded, rounds),
        terca: handStats[player].terca,
        kvarta: handStats[player].kvarta,
        kvintaOrLonger: handStats[player].kvinta,
        fourOfKind: handStats[player].quads,
      }])),
      eitherHandAnyDeclarationPercent: percentage(declaredHands, 2 * rounds),
      roundsWithAnyAwardPercent: percentage(roundsWithAward, rounds),
      meanAwardedPointsPerRound: Number((totalAwardedPoints / rounds).toFixed(3)),
      roleStats: Object.fromEntries(Object.entries(roleStats).map(([role, stats]) => [role, {
        observedHands: stats.hands,
        declarationsPercent: percentage(stats.declarations, stats.hands),
        awardedPercent: percentage(stats.awarded, stats.hands),
      }])),
      declarationCardSuits: Object.fromEntries(suitCount),
      declarationCardRanks: Object.fromEntries(rankCount),
    };
    console.info("Seeded declaration audit:", JSON.stringify(summary));
    expect(roleStats.dealer.hands).toBeGreaterThan(0);
    expect(roleStats.nonDealer.hands).toBeGreaterThan(0);
  }, 120_000);
});
