import { describe, expect, it } from "vitest";
import { compareDeclarations, detectDeclarations, getCardPointValue, getMatchWinner, settleRoundScore, updateBela } from "../src/game/scoring.js";
import type { BelaProgress, Card, Player, Suit, Declaration } from "../src/game/types.js";

const card = (suit: Suit, rank: Card["rank"]): Card => ({ id: `${suit}-${rank}`, suit, rank });
const emptyProgress: BelaProgress = { called: false, kingPlayed: false, queenPlayed: false, awarded: false, kingCard: null, queenCard: null };

describe("declarations detection and comparison", () => {
  it("detects runs, quads, and never counts shorter sequences inside a longer run", () => {
    const declarations = detectDeclarations([
      card("srce", "7"), card("srce", "8"), card("srce", "9"), card("srce", "10"),
      card("srce", "J"), card("tikva", "J"), card("žir", "J"), card("zelje", "J"),
    ]);
    expect(declarations).toHaveLength(2);
    expect(declarations.find((declaration) => declaration.kind === "sequence")).toMatchObject({ points: 100, sequenceLength: 5, highestRank: "J" });
    expect(declarations.find((declaration) => declaration.kind === "four-of-kind")).toMatchObject({ points: 200, rank: "J" });
  });

  it("compares the strongest declaration and gives equal strengths to the non-dealer", () => {
    const p1: Declaration[] = [{ kind: "sequence", points: 20, cards: [card("srce", "7"), card("srce", "8"), card("srce", "9")], sequenceLength: 3, highestRank: "9", rank: null }];
    const p2: Declaration[] = [{ kind: "sequence", points: 20, cards: [card("tikva", "Q"), card("tikva", "K"), card("tikva", "A")], sequenceLength: 3, highestRank: "A", rank: null }];
    expect(compareDeclarations({ player1: p1, player2: p2 }, "player1", "player2").winner).toBe("player2");
    const tied = compareDeclarations({ player1: p2, player2: [{ ...p2[0]!, cards: [card("srce", "Q"), card("srce", "K"), card("srce", "A")] }] }, "player1", "player2");
    expect(tied.winner).toBe("player2");
  });

  it("scores a maximum non-overlapping set", () => {
    const declarations = detectDeclarations([card("srce", "7"), card("srce", "8"), card("srce", "9"), card("srce", "10"), card("srce", "J")]);
    const result = compareDeclarations({ player1: declarations, player2: [] }, "player1", "player2");
    expect(result.pointsAwarded.player1).toBe(100);
    expect(result.scoredByPlayer.player1).toHaveLength(1);
  });
});

describe("Bela and round/match settlement", () => {
  it("awards Bela once only after it is called and both adut King and Queen are played", () => {
    const king = updateBela(emptyProgress, 0, card("srce", "K"), "srce");
    expect(king.points).toBe(0);
    expect(king.progress.kingCard).toEqual(card("srce", "K"));
    const queen = updateBela(king.progress, king.points, card("srce", "Q"), "srce", true);
    expect(queen.points).toBe(20);
    expect(queen.progress.queenCard).toEqual(card("srce", "Q"));
    expect(queen.progress.awarded).toBe(true);
    expect(updateBela(queen.progress, queen.points, card("srce", "K"), "srce", true).points).toBe(20);
    expect(updateBela(emptyProgress, 0, card("srce", "K"), "tikva").points).toBe(0);
    const declinedKing = updateBela(emptyProgress, 0, card("srce", "K"), "srce");
    const declinedQueen = updateBela(declinedKing.progress, declinedKing.points, card("srce", "Q"), "srce");
    expect(declinedQueen.points).toBe(0);
  });

  it("uses distinct trump and non-trump point values", () => {
    expect(getCardPointValue(card("srce", "J"), "srce")).toBe(20);
    expect(getCardPointValue(card("srce", "9"), "srce")).toBe(14);
    expect(getCardPointValue(card("srce", "J"), "tikva")).toBe(2);
    expect(getCardPointValue(card("srce", "A"), "tikva")).toBe(11);
  });

  it("settles contract failure, last-trick and stiglja bonuses", () => {
    const common = { declarationPoints: { player1: 0, player2: 0 }, belaPoints: { player1: 0, player2: 0 }, tricksWon: { player1: 10, player2: 0 }, lastTrickWinner: "player1" as Player };
    const success = settleRoundScore({ ...common, caller: "player1", trickPoints: { player1: 100, player2: 52 } });
    expect(success.roundTotals).toEqual({ player1: 200, player2: 52 });
    expect(success.matchPointsAwarded).toEqual(success.roundTotals);
    const tie = settleRoundScore({ ...common, caller: "player1", tricksWon: { player1: 5, player2: 5 }, lastTrickWinner: "player2", trickPoints: { player1: 81, player2: 71 } });
    expect(tie.contractSucceeded).toBe(false);
    expect(tie.matchPointsAwarded).toEqual({ player1: 0, player2: 162 });
  });

  it("transfers every round point, including the failed caller's zvanja and Bela, to the opponent", () => {
    const player2CalledAndFailed = settleRoundScore({
      caller: "player2",
      trickPoints: { player1: 162, player2: 0 },
      declarationPoints: { player1: 0, player2: 20 },
      belaPoints: { player1: 0, player2: 20 },
      tricksWon: { player1: 10, player2: 0 },
      lastTrickWinner: "player1",
    });
    expect(player2CalledAndFailed.contractSucceeded).toBe(false);
    expect(player2CalledAndFailed.roundTotals).toEqual({ player1: 262, player2: 40 });
    expect(player2CalledAndFailed.matchPointsAwarded).toEqual({ player1: 302, player2: 0 });

    const player1CalledAndFailed = settleRoundScore({
      caller: "player1",
      trickPoints: { player1: 50, player2: 100 },
      declarationPoints: { player1: 20, player2: 0 },
      belaPoints: { player1: 0, player2: 0 },
      tricksWon: { player1: 6, player2: 4 },
      lastTrickWinner: "player2",
    });
    expect(player1CalledAndFailed.contractSucceeded).toBe(false);
    expect(player1CalledAndFailed.matchPointsAwarded).toEqual({ player1: 0, player2: 180 });
  });

  it("resolves 1001 threshold after same-round totals", () => {
    expect(getMatchWinner({ player1: 1000, player2: 900 })).toBeNull();
    expect(getMatchWinner({ player1: 1010, player2: 1001 })).toBe("player1");
    expect(getMatchWinner({ player1: 1001, player2: 1001 })).toBeNull();
  });
});
