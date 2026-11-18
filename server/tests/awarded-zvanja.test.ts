import { describe, expect, it } from "vitest";
import { createDeck } from "../src/game/cards.js";
import { dealGame, getPlayerView } from "../src/game/game-engine.js";
import type { AwardedZvanja, Card, Declaration, GameState, Player } from "../src/game/types.js";

function card(id: string, suit: Card["suit"], rank: Card["rank"]): Card {
  return { id, suit, rank };
}

function makeAwardState(ordinaryPoints: 0 | 20 | 50, belaAwarded: boolean): GameState {
  const dealt = dealGame(createDeck());
  const ordinaryCards = [card("award-7", "srce", "7"), card("award-8", "srce", "8"), card("award-9", "srce", "9")];
  if (ordinaryPoints === 50) ordinaryCards.push(card("award-10", "srce", "10"));
  const ordinary: Declaration = {
    kind: "sequence", points: ordinaryPoints || 20, cards: ordinaryCards,
    sequenceLength: ordinaryCards.length, highestRank: ordinaryCards[ordinaryCards.length - 1]!.rank, rank: null,
  };
  const unawardedCards = [card("hidden-10", "tikva", "10"), card("hidden-j", "tikva", "J"), card("hidden-q", "tikva", "Q")];
  const unawarded: Declaration = {
    kind: "sequence", points: 20, cards: unawardedCards,
    sequenceLength: 3, highestRank: "Q", rank: null,
  };
  const king = card("bela-king", "srce", "K");
  const queen = card("bela-queen", "srce", "Q");
  const emptyProgress = { called: false, kingPlayed: false, queenPlayed: false, awarded: false, kingCard: null, queenCard: null };
  const player1: Player = "player1";
  const player2: Player = "player2";

  return {
    ...dealt,
    phase: "playing",
    currentBidder: null,
    currentPlayer: dealt.nonDealer,
    players: {
      player1: {
        initialCards: [card("own-a", "zelje", "7")], additionalCards: [],
      },
      player2: {
        initialCards: [king, queen], additionalCards: [],
      },
    },
    bidding: { turn: 1, selectedSuit: "srce", selectedBy: dealt.nonDealer },
    declarationsByPlayer: { player1: [unawarded], player2: ordinaryPoints ? [ordinary] : [] },
    declarationComparisonResult: ordinaryPoints
      ? { winner: player2, pointsAwarded: { player1: 0, player2: ordinaryPoints }, scoredByPlayer: { player1: [], player2: [ordinary] } }
      : { winner: null, pointsAwarded: { player1: 0, player2: 0 }, scoredByPlayer: { player1: [], player2: [] } },
    belaProgress: {
      player1: emptyProgress,
      player2: { called: belaAwarded, kingPlayed: belaAwarded, queenPlayed: belaAwarded, awarded: belaAwarded, kingCard: belaAwarded ? king : null, queenCard: belaAwarded ? queen : null },
    },
    belaPoints: { player1: 0, player2: belaAwarded ? 20 : 0 },
  };
}

describe("server awarded zvanja projection", () => {
  it.each([
    { ordinary: 20 as const, bela: false, total: 20, names: ["Terca"] },
    { ordinary: 0 as const, bela: true, total: 20, names: ["Bela"] },
    { ordinary: 20 as const, bela: true, total: 40, names: ["Terca", "Bela"] },
    { ordinary: 50 as const, bela: true, total: 70, names: ["Kvarta", "Bela"] },
  ])("publishes only earned items and totals $total points", ({ ordinary, bela, total, names }) => {
    const state = makeAwardState(ordinary, bela);
    const view = getPlayerView(state, "player1");

    expect(view.zvanjaPointsAwarded).toEqual({ player1: 0, player2: total });
    expect(view.awardedZvanja.player2.map(({ name }) => name)).toEqual(names);
    expect(view.awardedZvanja.player2.every((item: AwardedZvanja) => item.points > 0 && item.player === "player2")).toBe(true);
    const belaItem = view.awardedZvanja.player2.find(({ kind }) => kind === "bela");
    if (bela) {
      expect(belaItem?.cards).toEqual([card("bela-king", "srce", "K"), card("bela-queen", "srce", "Q")]);
      expect(view.awardedZvanja.player2.filter(({ kind }) => kind === "bela")).toHaveLength(1);
    } else {
      expect(belaItem).toBeUndefined();
    }
    expect(view.awardedZvanja.player1).toEqual([]);
    expect(view.hands.player2.cards).toEqual([]);
    expect(view).not.toHaveProperty("declarationsByPlayer");
    expect(JSON.stringify(view)).not.toContain("hidden-10");
  });

  it("does not reveal Bela cards until the engine has awarded Bela, and keeps awarded details available during the round", () => {
    const awaitingBela = makeAwardState(20, false);
    const beforeAward = getPlayerView(awaitingBela, "player1");
    expect(beforeAward.zvanjaPointsAwarded.player2).toBe(20);
    expect(beforeAward.awardedZvanja.player2.map(({ name }) => name)).toEqual(["Terca"]);
    expect(JSON.stringify(beforeAward)).not.toContain("bela-king");

    const belaAwarded = makeAwardState(20, true);
    const playingView = getPlayerView(belaAwarded, "player1");
    expect(getPlayerView(belaAwarded, "player1").awardedZvanja).toEqual(playingView.awardedZvanja);
    expect(getPlayerView({ ...belaAwarded, phase: "round-complete" }, "player1").awardedZvanja).toEqual(playingView.awardedZvanja);
  });
});
