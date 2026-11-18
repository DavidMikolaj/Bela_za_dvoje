import { describe, expect, it } from "vitest";
import { createDeck } from "../src/game/cards.js";
import { dealGame, getPlayerView, playCard, submitBid } from "../src/game/game-engine.js";
import { SUITS, type Card, type Player, type Suit } from "../src/game/types.js";
import { detectDeclarations } from "../src/game/scoring.js";

function selectAdut(state: ReturnType<typeof dealGame>, adut: Suit) {
  if (adut === state.originalFaceUpCard.suit) {
    return submitBid(state, state.nonDealer, adut);
  }
  const secondTurn = submitBid(state, state.nonDealer, null);
  const thirdTurn = submitBid(secondTurn, state.dealer, null);
  return submitBid(thirdTurn, state.nonDealer, adut);
}

function handCards(state: ReturnType<typeof dealGame>, player: Player): Card[] {
  const hand = state.players[player];
  return [...hand.initialCards, ...hand.additionalCards];
}

function allDealtCardZones(state: ReturnType<typeof dealGame>): Card[] {
  return [
    ...handCards(state, "player1"),
    ...handCards(state, "player2"),
    state.faceUpCard,
    ...state.faceDownStack,
  ];
}

describe("face-up Seven exchange", () => {
  it("exchanges the matching Seven for the original upcard before play starts", () => {
    const dealt = dealGame(createDeck());
    const originalUpcard = dealt.originalFaceUpCard;
    const seven = dealt.players[dealt.nonDealer].initialCards.find(
      (candidate) => candidate.suit === originalUpcard.suit && candidate.rank === "7",
    )!;

    const state = selectAdut(dealt, originalUpcard.suit);
    const recipientHand = handCards(state, dealt.nonDealer);

    expect(state.phase).toBe("playing");
    expect(state.faceUpExchangeChecked).toBe(true);
    expect(state.faceUpCard).toEqual(seven);
    expect(recipientHand).toContainEqual(originalUpcard);
    expect(recipientHand).not.toContainEqual(seven);
    expect(handCards(state, dealt.nonDealer)).toHaveLength(10);
    expect(handCards(state, dealt.dealer)).toHaveLength(10);

    const recipientView = getPlayerView(state, dealt.nonDealer);
    expect(recipientView.hands[dealt.nonDealer].cards).toContainEqual(originalUpcard);
    expect(recipientView.legalCardIds).toContain(originalUpcard.id);
    const played = playCard(state, dealt.nonDealer, originalUpcard.id);
    expect(played.currentTrick.cards[0]!.card).toEqual(originalUpcard);
  });

  it("performs the exchange regardless of which suit was selected as adut", () => {
    for (const adut of SUITS) {
      const dealt = dealGame(createDeck());
      const selected = selectAdut(dealt, adut);
      expect(selected.bidding.selectedSuit).toBe(adut);
      expect(selected.faceUpCard.id).toBe(`${dealt.originalFaceUpCard.suit}-7`);
      expect(handCards(selected, dealt.nonDealer)).toContainEqual(dealt.originalFaceUpCard);
      expect(selected.faceUpExchangeChecked).toBe(true);
    }
  });

  it("evaluates declarations from the exchanged hands before play begins", () => {
    const deck = createDeck();
    // Put srce-10 face-up; Player 2's srce-7, 8, 9 become 10, 8, 9 after exchange.
    [deck[3], deck[12]] = [deck[12]!, deck[3]!];
    const dealt = dealGame(deck);
    const selected = selectAdut(dealt, "srce");
    const expected = detectDeclarations(handCards(selected, dealt.nonDealer));

    expect(selected.faceUpExchangeChecked).toBe(true);
    expect(selected.declarationsByPlayer[dealt.nonDealer]).toEqual(expected);
    expect(expected.some((declaration) => declaration.kind === "sequence" && declaration.cards.some(({ id }) => id === "srce-10"))).toBe(true);
  });

  it("exchanges the card when the dealer, rather than the non-dealer, holds the matching Seven", () => {
    const deck = createDeck();
    [deck[3], deck[8]] = [deck[8]!, deck[3]!];
    const dealt = dealGame(deck);
    expect(dealt.players[dealt.dealer].initialCards).toContainEqual({ id: "tikva-7", suit: "tikva", rank: "7" });

    const selected = selectAdut(dealt, "srce");
    expect(handCards(selected, dealt.dealer)).toContainEqual(dealt.originalFaceUpCard);
    expect(handCards(selected, dealt.nonDealer)).not.toContainEqual(dealt.originalFaceUpCard);
    expect(selected.faceUpCard.id).toBe("tikva-7");
  });

  it("does not exchange when the original face-up card is a Seven", () => {
    const deck = createDeck();
    const sevenIndex = deck.findIndex((card) => card.id === "srce-7");
    [deck[sevenIndex], deck[12]] = [deck[12]!, deck[sevenIndex]!];
    const dealt = dealGame(deck);
    const handsBefore = {
      player1: handCards(dealt, "player1"),
      player2: handCards(dealt, "player2"),
    };

    const selected = selectAdut(dealt, dealt.originalFaceUpCard.suit);
    expect(selected.faceUpCard).toEqual(dealt.originalFaceUpCard);
    expect(handCards(selected, "player1")).toEqual(handsBefore.player1);
    expect(handCards(selected, "player2")).toEqual(handsBefore.player2);
    expect(selected.faceUpExchangeChecked).toBe(true);
  });

  it("preserves ten cards per player and all 32 unique card identities", () => {
    const dealt = dealGame(createDeck());
    const selected = selectAdut(dealt, "srce");
    const zones = allDealtCardZones(selected);

    expect(handCards(selected, "player1")).toHaveLength(10);
    expect(handCards(selected, "player2")).toHaveLength(10);
    expect(zones).toHaveLength(32);
    expect(new Set(zones.map(({ id }) => id)).size).toBe(32);
    expect(zones.map(({ id }) => id).sort()).toEqual(createDeck().map(({ id }) => id).sort());
  });

  it("does not expose the exchange recipient through the opponent's hand view", () => {
    const dealt = dealGame(createDeck());
    const selected = selectAdut(dealt, dealt.originalFaceUpCard.suit);
    const recipient = dealt.nonDealer;
    const opponent: Player = recipient === "player1" ? "player2" : "player1";
    const opponentView = getPlayerView(selected, opponent);

    expect(opponentView.hands[recipient].cards).toEqual([]);
    expect(opponentView).not.toHaveProperty("declarationsByPlayer");
    expect(opponentView).not.toHaveProperty("exchangePlayer");
  });
});
