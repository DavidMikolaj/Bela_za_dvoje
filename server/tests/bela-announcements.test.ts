import { describe, expect, it } from "vitest";
import { createDeck } from "../src/game/cards.js";
import { acknowledgeTrick, dealGame, getBelaAnnouncementCardIds, getPlayerView, playCard } from "../src/game/game-engine.js";
import type { Card, GameState, Player } from "../src/game/types.js";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "srce"): Card => ({ id, suit, rank });

function stateWithBelaPair(): GameState {
  const dealt = dealGame(createDeck());
  const king = card("test-adut-king", "K");
  const queen = card("test-adut-queen", "Q");
  const response = card("test-response", "7");
  const progress = { called: false, kingPlayed: false, queenPlayed: false, awarded: false, kingCard: null, queenCard: null };
  return {
    ...dealt,
    phase: "playing",
    currentBidder: null,
    currentPlayer: dealt.nonDealer,
    players: {
      player1: { initialCards: [response], additionalCards: [] },
      player2: { initialCards: [king, queen], additionalCards: [] },
    },
    bidding: { turn: 1, selectedSuit: "srce", selectedBy: dealt.nonDealer },
    belaProgress: { player1: progress, player2: progress },
    belaPoints: { player1: 0, player2: 0 },
  };
}

function completeFirstTrick(state: GameState, announceKing: boolean): GameState {
  const player = state.currentPlayer!;
  const king = state.players[player].initialCards.find(({ rank }) => rank === "K")!;
  let next = playCard(state, player, king.id, announceKing);
  const responder = next.currentPlayer!;
  next = playCard(next, responder, next.players[responder].initialCards[0]!.id);
  return acknowledgeTrick(next);
}

describe("optional Bela announcement", () => {
  it("offers the call only for legal adut King/Queen cards to the player holding the pair", () => {
    const state = stateWithBelaPair();
    const player = state.nonDealer;
    const king = state.players[player].initialCards.find(({ rank }) => rank === "K")!;
    const queen = state.players[player].initialCards.find(({ rank }) => rank === "Q")!;
    const view = getPlayerView(state, player);

    expect(view.belaAnnouncementCardIds).toEqual([king.id, queen.id]);
    expect(getPlayerView(state, state.dealer).belaAnnouncementCardIds).toEqual([]);
    expect(getPlayerView(state, state.dealer).hands[player].cards).toEqual([]);
  });

  it("lets the player decline on the first card and announce on the other card", () => {
    const initial = stateWithBelaPair();
    let state = completeFirstTrick(initial, false);
    const caller = initial.nonDealer;
    const queen = state.players[caller].initialCards.find(({ rank }) => rank === "Q")!;

    expect(state.belaProgress[caller].called).toBe(false);
    expect(state.belaPoints[caller]).toBe(0);
    expect(getBelaAnnouncementCardIds(state, caller)).toContain(queen.id);

    state = playCard(state, caller, queen.id, true);
    expect(state.belaProgress[caller].called).toBe(true);
    expect(state.belaProgress[caller].awarded).toBe(true);
    expect(state.belaPoints[caller]).toBe(20);
    expect(getPlayerView(state, state.dealer).zvanjaPointsAwarded[caller]).toBe(20);
    expect(getPlayerView(state, state.dealer).awardedZvanja[caller]).toMatchObject([
      { name: "Bela", points: 20, player: caller, cards: [initial.players[caller].initialCards[0], queen] },
    ]);
  });

  it("accepts announcing Bela on the King and awards it once the Queen is played", () => {
    const initial = stateWithBelaPair();
    let state = completeFirstTrick(initial, true);
    const caller = initial.nonDealer;
    const queen = state.players[caller].initialCards.find(({ rank }) => rank === "Q")!;
    expect(state.belaProgress[caller].called).toBe(true);
    expect(state.belaPoints[caller]).toBe(0);
    expect(getPlayerView(state, caller).belaAnnouncements).toHaveLength(1);

    state = playCard(state, caller, queen.id, false);
    expect(state.belaPoints[caller]).toBe(20);
    expect(state.belaProgress[caller].awarded).toBe(true);
    expect(getPlayerView(state, caller).belaAnnouncements).toHaveLength(1);
    expect(getPlayerView(state, caller).awardedZvanja[caller].filter(({ kind }) => kind === "bela")).toHaveLength(1);
  });

  it.each(["K", "Q"] as const)("publishes the King/Queen announcement immediately when %s is played first", (rank) => {
    const initial = stateWithBelaPair();
    const caller = initial.currentPlayer!;
    const first = initial.players[caller].initialCards.find((candidate) => candidate.rank === rank)!;
    const state = playCard(initial, caller, first.id, true);
    const other = caller === "player1" ? "player2" : "player1";

    expect(getPlayerView(state, caller).belaAnnouncements).toEqual([expect.objectContaining({
      player: caller,
      pointsAwarded: false,
      cards: expect.arrayContaining([expect.objectContaining({ rank: "K" }), expect.objectContaining({ rank: "Q" })]),
    })]);
    expect(getPlayerView(state, other).belaAnnouncements).toHaveLength(1);
    expect(state.belaPoints[caller]).toBe(0);
  });

  it("does not award Bela when the player declines both announcement opportunities", () => {
    const initial = stateWithBelaPair();
    let state = completeFirstTrick(initial, false);
    const caller = initial.nonDealer;
    const queen = state.players[caller].initialCards.find(({ rank }) => rank === "Q")!;
    state = playCard(state, caller, queen.id, false);

    expect(state.belaProgress[caller].called).toBe(false);
    expect(state.belaProgress[caller].awarded).toBe(false);
    expect(state.belaPoints[caller]).toBe(0);
    expect(getPlayerView(state, caller).awardedZvanja[caller]).toEqual([]);
  });

  it("rejects attempts to call Bela without the adut pair", () => {
    const state = stateWithBelaPair();
    const player: Player = state.nonDealer;
    const onlyKing = {
      ...state,
      players: { ...state.players, [player]: { initialCards: [card("only-king", "K")], additionalCards: [] } },
    };
    expect(getBelaAnnouncementCardIds(onlyKing, player)).toEqual([]);
    expect(() => playCard(onlyKing, player, "only-king", true)).toThrow(/Belu možete zvati/i);
  });
});
