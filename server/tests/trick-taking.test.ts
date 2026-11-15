import { describe, expect, it } from "vitest";
import { createDeck } from "../src/game/cards.js";
import {
  acknowledgeTrick,
  dealGame,
  determineTrickWinner,
  endTestRound,
  getCardRankStrength,
  getLegalCards,
  getPlayerView,
  playCard,
  startNextRound,
  submitBid,
} from "../src/game/game-engine.js";
import type { Card, Player, Rank, Suit } from "../src/game/types.js";
import { getCardPointValue } from "../src/game/scoring.js";

function card(suit: Suit, rank: Rank): Card {
  return { id: `${suit}-${rank}`, suit, rank };
}

function hand(state: ReturnType<typeof playingRound>, player: Player): Card[] {
  return [...state.players[player].initialCards, ...state.players[player].additionalCards];
}

function playingRound() {
  const dealt = dealGame(createDeck());
  return submitBid(dealt, dealt.nonDealer, dealt.faceUpCard.suit);
}

describe("Bela card strength and legal plays", () => {
  it("uses the correct adut and non-adut rank orders", () => {
    const adutOrder: Rank[] = ["J", "9", "A", "10", "K", "Q", "8", "7"];
    const nonAdutOrder: Rank[] = ["A", "10", "K", "Q", "J", "9", "8", "7"];

    for (const order of [adutOrder, nonAdutOrder]) {
      const suit: Suit = order === adutOrder ? "srce" : "tikva";
      const adut: Suit = order === adutOrder ? "srce" : "zelje";
      const strengths = order.map((rank) => getCardRankStrength(rank, suit, adut));
      expect(strengths.every((strength, index) => index === 0 || strengths[index - 1]! > strength)).toBe(true);
    }
  });

  it("allows any lead and requires following suit when possible", () => {
    const lead = { player: "player1" as const, card: card("srce", "Q") };
    const cards = [card("zelje", "A"), card("srce", "7"), card("tikva", "J")];

    expect(getLegalCards(cards, [], "tikva")).toEqual(cards);
    expect(getLegalCards(cards, [lead], "tikva").map(({ id }) => id)).toEqual(["srce-7"]);
  });

  it("requires beating the led suit when possible, but allows a lower follow when not", () => {
    const lead = { player: "player1" as const, card: card("srce", "Q") };
    const canBeat = [card("srce", "K"), card("srce", "7"), card("tikva", "J")];
    expect(getLegalCards(canBeat, [lead], "tikva").map(({ id }) => id)).toEqual(["srce-K"]);

    const cannotBeat = [card("srce", "7"), card("srce", "J"), card("tikva", "J")];
    expect(getLegalCards(cannotBeat, [{ ...lead, card: card("srce", "A") }], "tikva").map(({ id }) => id))
      .toEqual(["srce-7", "srce-J"]);
  });

  it("requires trumping when void in the led suit", () => {
    const lead = { player: "player1" as const, card: card("srce", "A") };
    const cards = [card("tikva", "7"), card("zelje", "A")];
    expect(getLegalCards(cards, [lead], "tikva").map(({ id }) => id)).toEqual(["tikva-7"]);
  });

  it("requires overtrumping a led adut when possible, while allowing a low adut otherwise", () => {
    const lead = { player: "player1" as const, card: card("tikva", "9") };
    const canOvertrump = [card("tikva", "J"), card("tikva", "7"), card("zelje", "A")];
    expect(getLegalCards(canOvertrump, [lead], "tikva").map(({ id }) => id)).toEqual(["tikva-J"]);

    const cannotOvertrump = [card("tikva", "7"), card("zelje", "A")];
    expect(getLegalCards(cannotOvertrump, [lead], "tikva").map(({ id }) => id)).toEqual(["tikva-7"]);
  });

  it("allows any discard when unable to follow and holding no adut", () => {
    const lead = { player: "player1" as const, card: card("srce", "A") };
    const cards = [card("tikva", "7"), card("žir", "J")];
    expect(getLegalCards(cards, [lead], "zelje")).toEqual(cards);
  });

  it("determines the trick winner using suit and rank strength", () => {
    const ledPlayer = { player: "player1" as const, card: card("srce", "A") };
    expect(determineTrickWinner([
      ledPlayer,
      { player: "player2", card: card("srce", "7") },
    ], "tikva")).toBe("player1");
    expect(determineTrickWinner([
      ledPlayer,
      { player: "player2", card: card("tikva", "7") },
    ], "tikva")).toBe("player2");
  });
});

describe("server-authoritative trick flow", () => {
  it("starts with the non-dealer, removes played cards, and hands the lead to each trick winner", () => {
    let state = playingRound();
    expect(state.currentPlayer).toBe(state.nonDealer);
    expect(state.currentTrick.number).toBe(1);

    const leader = state.currentPlayer!;
    const leadCard = hand(state, leader)[0]!;
    state = playCard(state, leader, leadCard.id);
    expect(hand(state, leader)).toHaveLength(9);
    expect(state.currentTrick.cards[0]).toEqual({ player: leader, card: leadCard });
    expect(state.currentPlayer).not.toBe(leader);

    const responder = state.currentPlayer!;
    const legalResponse = getLegalCards(hand(state, responder), state.currentTrick.cards, state.bidding.selectedSuit!)[0]!;
    state = playCard(state, responder, legalResponse.id);
    expect(hand(state, responder)).toHaveLength(9);
    expect(state.phase).toBe("trick-complete");
    expect(state.currentTrick.cards).toHaveLength(2);
    expect(state.awaitingTrickAcknowledgement).toBe(true);

    const winner = state.currentTrick.winner!;
    const visibleResult = state.currentTrick;
    state = acknowledgeTrick(state);
    expect(state.currentPlayer).toBe(winner);
    expect(state.currentTrick.number).toBe(2);
    expect(state.currentTrick.cards).toEqual([]);
    expect(visibleResult.cards).toHaveLength(2);
  });

  it("rejects opponent cards and cards that break follow-suit rules", () => {
    let state = playingRound(); // Ordered deck: player 2 can lead srce-7; player 1 holds srce.
    const leader = state.nonDealer;
    const opponent = state.dealer;
    state = playCard(state, leader, "srce-7");

    expect(() => playCard(state, opponent, "srce-7")).toThrow(/not in this player's hand/i);
    expect(() => playCard(state, opponent, "tikva-8")).toThrow(/not a legal play/i);
    expect(state.currentTrick.cards).toHaveLength(1);
  });

  it("keeps the opponent hand private while exposing the played card and legal IDs only to the turn player", () => {
    let state = playingRound();
    const firstPlayer = state.currentPlayer!;
    const played = hand(state, firstPlayer)[0]!;
    state = playCard(state, firstPlayer, played.id);

    const responsePlayer = state.currentPlayer!;
    const view = getPlayerView(state, responsePlayer);
    const opponent = responsePlayer === "player1" ? "player2" : "player1";
    const hiddenCard = hand(state, opponent)[0]!;
    expect(view.hands[opponent].cards).toEqual([]);
    expect(view.hands[responsePlayer].cards).toHaveLength(10);
    expect(view.currentTrick.cards[0]!.card).toEqual(played);
    expect(view.legalCardIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain(hiddenCard.id);
    expect(view.ordinaryZvanjaByPlayer[responsePlayer]).toEqual(state.ordinaryZvanjaByPlayer[responsePlayer]);
    expect(view.ordinaryZvanjaByPlayer[opponent]).toEqual([]);
    expect(view.ordinaryZvanjaResult).toBeNull();
  });

  it("plays exactly ten tricks, retains collections, and waits for acknowledgement before advancing", () => {
    let state = playingRound();
    const expectedPlayedCardPoints = (["player1", "player2"] as const)
      .flatMap((player) => hand(state, player))
      .reduce((sum, card) => sum + getCardPointValue(card, state.bidding.selectedSuit!), 0);

    for (let trickIndex = 0; trickIndex < 10; trickIndex += 1) {
      expect(state.phase).toBe("playing");
      const leader = state.currentPlayer!;
      const lead = hand(state, leader)[0]!;
      state = playCard(state, leader, lead.id);
      const responder = state.currentPlayer!;
      const response = getLegalCards(hand(state, responder), state.currentTrick.cards, state.bidding.selectedSuit!)[0]!;
      state = playCard(state, responder, response.id);

      expect(state.tricksPlayed).toBe(trickIndex + 1);
      expect(state.currentTrick.cards).toHaveLength(2);
      expect(state.collectedCards.player1.length + state.collectedCards.player2.length).toBe((trickIndex + 1) * 2);

      if (trickIndex < 9) {
        const trickWinner = state.currentTrick.winner!;
        const resultCards = state.currentTrick.cards;
        expect(state.phase).toBe("trick-complete");
        expect(() => startNextRound(state, createDeck())).toThrow();
        state = acknowledgeTrick(state);
        expect(state.currentPlayer).toBe(trickWinner);
        expect(state.currentTrick.cards).toEqual([]);
        expect(resultCards).toHaveLength(2);
      }
    }

    expect(state.phase).toBe("round-complete");
    expect(state.tricksPlayed).toBe(10);
    expect(state.tricksWon.player1 + state.tricksWon.player2).toBe(10);
    expect(state.trickPoints.player1 + state.trickPoints.player2).toBe(expectedPlayedCardPoints);
    expect(state.roundScore).not.toBeNull();
    expect(state.roundScore!.lastTrickBonus.player1 + state.roundScore!.lastTrickBonus.player2).toBe(10);
    expect(state.roundScore!.stigljaBonus.player1 + state.roundScore!.stigljaBonus.player2)
      .toBe(state.tricksWon.player1 === 10 || state.tricksWon.player2 === 10 ? 90 : 0);
    expect(state.matchScores.player1 + state.matchScores.player2).toBeGreaterThan(0);
    expect(state.players.player1.initialCards.length + state.players.player1.additionalCards.length).toBe(0);
    expect(state.players.player2.initialCards.length + state.players.player2.additionalCards.length).toBe(0);
    expect(state.awaitingTrickAcknowledgement).toBe(true);
    expect(() => startNextRound(state, createDeck())).toThrow();

    state = acknowledgeTrick(state);
    expect(state.phase).toBe("round-complete");
    expect(state.awaitingTrickAcknowledgement).toBe(false);
    expect(state.currentTrick.cards).toHaveLength(2);
    const completedView = getPlayerView(state, state.nonDealer);
    expect(completedView.ordinaryZvanjaResult).not.toBeNull();
    expect(completedView.ordinaryZvanjaByPlayer.player1.length + completedView.ordinaryZvanjaByPlayer.player2.length)
      .toBe(state.ordinaryZvanjaByPlayer.player1.length + state.ordinaryZvanjaByPlayer.player2.length);
    const nextRound = startNextRound(state, createDeck());
    expect(nextRound.completedRounds).toHaveLength(1);
    expect(nextRound.completedRounds[0]!.collectedCards.player1.length +
      nextRound.completedRounds[0]!.collectedCards.player2.length).toBe(20);
    expect(nextRound.completedRounds[0]!.score).toEqual(state.roundScore);
    expect(nextRound.matchScores).toEqual(state.matchScores);
    expect(nextRound.dealer).not.toBe(state.dealer);
  });

  it("rejects a player action from the wrong turn", () => {
    const state = playingRound();
    expect(() => playCard(state, state.dealer, hand(state, state.dealer)[0]!.id)).toThrow(/turn to play/i);
  });

  it("does not allow ending a test while a completed trick awaits acknowledgement", () => {
    let state = playingRound();
    const firstPlayer = state.currentPlayer!;
    state = playCard(state, firstPlayer, hand(state, firstPlayer)[0]!.id);
    const secondPlayer = state.currentPlayer!;
    const response = getLegalCards(hand(state, secondPlayer), state.currentTrick.cards, state.bidding.selectedSuit!)[0]!;
    state = playCard(state, secondPlayer, response.id);
    expect(() => endTestRound(state)).toThrow(/bidding or card play/i);
  });
});
