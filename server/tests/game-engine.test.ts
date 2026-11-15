import { describe, expect, it } from "vitest";
import { createDeck, RANKS } from "../src/game/cards.js";
import {
  completeRound,
  dealGame,
  GameRuleError,
  getDealerForRound,
  getNextDealer,
  getPlayerView,
  startNextRound,
  submitBid,
} from "../src/game/game-engine.js";
import { shuffleDeck } from "../src/game/shuffle.js";
import { SUITS, type Suit } from "../src/game/types.js";

function orderedGame() {
  return dealGame(createDeck());
}

describe("Mađarice deck", () => {
  it("has exactly 32 uniquely identified cards and eight per suit", () => {
    const deck = createDeck();

    expect(deck).toHaveLength(32);
    expect(new Set(deck.map((card) => card.id)).size).toBe(32);
    for (const suit of SUITS) {
      expect(deck.filter((card) => card.suit === suit)).toHaveLength(8);
    }
    expect(new Set(deck.map((card) => card.rank))).toEqual(new Set(RANKS));
  });

  it("shuffles without changing or losing any input cards", () => {
    const deck = createDeck();
    const originalOrder = deck.map((card) => card.id);
    const shuffled = shuffleDeck(deck);

    expect(deck.map((card) => card.id)).toEqual(originalOrder);
    expect(shuffled).toHaveLength(32);
    expect(shuffled.map((card) => card.id).sort()).toEqual([...originalOrder].sort());
    expect(shuffled).not.toBe(deck);
  });
});

describe("deal and player visibility", () => {
  it("deals ten cards each, in the required packet order, with the remaining cards separate", () => {
    const deck = createDeck();
    const state = dealGame(deck);

    expect(state.players.player2.initialCards.map(({ id }) => id)).toEqual(
      [...deck.slice(0, 3), ...deck.slice(6, 9)].map(({ id }) => id),
    );
    expect(state.players.player1.initialCards.map(({ id }) => id)).toEqual(
      [...deck.slice(3, 6), ...deck.slice(9, 12)].map(({ id }) => id),
    );
    expect(state.players.player2.initialCards.length + state.players.player2.additionalCards.length).toBe(10);
    expect(state.players.player1.initialCards.length + state.players.player1.additionalCards.length).toBe(10);
    expect(state.faceUpCard).toEqual(deck[12]);
    expect(state.players.player2.additionalCards).toEqual(deck.slice(13, 17));
    expect(state.players.player1.additionalCards).toEqual(deck.slice(17, 21));
    expect(state.faceDownStack).toEqual(deck.slice(21));
    expect(state.faceDownStack).toHaveLength(11);
    expect(state.players.player1.initialCards.concat(state.players.player1.additionalCards)).not.toContain(state.faceUpCard);
  });

  it("shows only a player's initial six during bidding and all ten after adut selection", () => {
    const state = orderedGame();
    const player2View = getPlayerView(state, "player2");

    expect(player2View.hands.player2.cards).toHaveLength(6);
    expect(player2View.hands.player2.hiddenCardCount).toBe(4);
    expect(player2View.hands.player1.cards).toEqual([]);
    expect(player2View.hands.player1.cardCount).toBe(10);
    expect(player2View.faceDownStackCount).toBe(11);
    expect(JSON.stringify(player2View)).not.toContain(state.players.player2.additionalCards[0]!.id);
    expect(JSON.stringify(player2View)).not.toContain(state.players.player1.initialCards[0]!.id);
    expect(JSON.stringify(player2View)).not.toContain(state.faceDownStack[0]!.id);

    const player1View = getPlayerView(state, "player1");
    expect(player1View.hands.player1.cards).toHaveLength(6);
    expect(player1View.hands.player2.cards).toEqual([]);
    expect(JSON.stringify(player1View)).not.toContain(state.players.player1.additionalCards[0]!.id);

    const selected = submitBid(state, "player2", state.faceUpCard.suit);
    const afterSelection = getPlayerView(selected, "player2");
    expect(afterSelection.hands.player2.cards).toHaveLength(10);
    expect(afterSelection.hands.player1.cards).toEqual([]);
    expect(afterSelection.hands.player1.cardCount).toBe(10);
    expect(JSON.stringify(afterSelection)).not.toContain(state.players.player1.initialCards[0]!.id);

    const player1AfterSelection = getPlayerView(selected, "player1");
    expect(player1AfterSelection.hands.player1.cards).toHaveLength(10);
    expect(player1AfterSelection.hands.player2.cards).toEqual([]);
    expect(player1AfterSelection.hands.player2.cardCount).toBe(10);
  });

  it("rejects decks that are not exactly 32 unique cards", () => {
    const deck = createDeck();
    expect(() => dealGame(deck.slice(1))).toThrow(GameRuleError);
    expect(() => dealGame(deck.map((card, index) => index === 0 ? deck[1]! : card))).toThrow(GameRuleError);
  });
});

describe("alternating dealer and round transitions", () => {
  it("assigns the dealer by round number, beginning with player 1", () => {
    expect(getDealerForRound(1)).toBe("player1");
    expect(getDealerForRound(2)).toBe("player2");
    expect(getDealerForRound(3)).toBe("player1");
    expect(getNextDealer("player1")).toBe("player2");
    expect(getNextDealer("player2")).toBe("player1");
    expect(() => getDealerForRound(0)).toThrow(GameRuleError);
  });

  it("deals to the non-dealer first for rounds one and two", () => {
    const deck = createDeck();
    const round1 = dealGame(deck, 1);
    expect(round1.dealer).toBe("player1");
    expect(round1.nonDealer).toBe("player2");
    expect(round1.players[round1.nonDealer].initialCards.map(({ id }) => id)).toEqual(
      [...deck.slice(0, 3), ...deck.slice(6, 9)].map(({ id }) => id),
    );
    expect(round1.players[round1.dealer].initialCards.map(({ id }) => id)).toEqual(
      [...deck.slice(3, 6), ...deck.slice(9, 12)].map(({ id }) => id),
    );

    const round2 = dealGame(deck, 2);
    expect(round2.dealer).toBe("player2");
    expect(round2.nonDealer).toBe("player1");
    expect(round2.players[round2.nonDealer].initialCards.map(({ id }) => id)).toEqual(
      [...deck.slice(0, 3), ...deck.slice(6, 9)].map(({ id }) => id),
    );
    expect(round2.players[round2.dealer].initialCards.map(({ id }) => id)).toEqual(
      [...deck.slice(3, 6), ...deck.slice(9, 12)].map(({ id }) => id),
    );

    expect(dealGame(deck, 3).dealer).toBe("player1");
  });

  it("tracks the non-dealer first and alternates bidding roles for either dealer", () => {
    for (const roundNumber of [1, 2]) {
      const state = dealGame(createDeck(), roundNumber);
      expect(state.currentBidder).toBe(state.nonDealer);

      const turn2 = submitBid(state, state.nonDealer, null);
      expect(turn2.currentBidder).toBe(state.dealer);
      const turn3 = submitBid(turn2, state.dealer, null);
      expect(turn3.currentBidder).toBe(state.nonDealer);
      const turn4 = submitBid(turn3, state.nonDealer, null);
      expect(turn4.currentBidder).toBe(state.dealer);

      const alternate = SUITS.find((suit) => suit !== state.faceUpCard.suit)!;
      const selected = submitBid(turn4, state.dealer, alternate);
      expect(selected.bidding.selectedBy).toBe(state.dealer);
      expect(selected.currentBidder).toBeNull();
      expect(selected.dealer).toBe(state.dealer);
      expect(selected.nonDealer).toBe(state.nonDealer);
    }
  });

  it("requires the dealer to call on turn four and rejects a face-up suit there", () => {
    for (const roundNumber of [1, 2]) {
      const state = dealGame(createDeck(), roundNumber);
      const turn2 = submitBid(state, state.nonDealer, null);
      const turn3 = submitBid(turn2, state.dealer, null);
      const turn4 = submitBid(turn3, state.nonDealer, null);

      expect(turn4.currentBidder).toBe(state.dealer);
      expect(() => submitBid(turn4, state.dealer, null)).toThrow("Passing is not allowed");
      expect(() => submitBid(turn4, state.dealer, state.faceUpCard.suit)).toThrow(GameRuleError);
    }
  });

  it("keeps the dealer fixed through a round and switches exactly once on transition", () => {
    const round1 = dealGame(createDeck(), 1);
    const round1Selected = submitBid(round1, round1.nonDealer, round1.faceUpCard.suit);
    const completedRound1 = completeRound(round1Selected);

    expect(round1Selected.dealer).toBe("player1");
    expect(completedRound1.dealer).toBe("player1");
    expect(() => startNextRound(round1Selected, createDeck())).toThrow(GameRuleError);

    const round2 = startNextRound(completedRound1, createDeck());
    expect(round2.roundNumber).toBe(2);
    expect(round2.dealer).toBe("player2");
    expect(round2.nonDealer).toBe("player1");
    expect(() => startNextRound(round2, createDeck())).toThrow(GameRuleError);

    const round2Selected = submitBid(round2, round2.nonDealer, round2.faceUpCard.suit);
    const round3 = startNextRound(completeRound(round2Selected), createDeck());
    expect(round3.roundNumber).toBe(3);
    expect(round3.dealer).toBe("player1");
  });
});

describe("adut bidding", () => {
  it("follows turns 1 through 4 and records the selected suit, player, and phase", () => {
    const state = orderedGame();
    const upSuit = state.faceUpCard.suit;
    const alternateSuit = SUITS.find((suit) => suit !== upSuit)!;

    const turn2 = submitBid(state, "player2", null);
    expect(turn2.bidding.turn).toBe(2);
    const turn3 = submitBid(turn2, "player1", null);
    expect(turn3.bidding.turn).toBe(3);
    const turn4 = submitBid(turn3, "player2", null);
    expect(turn4.bidding.turn).toBe(4);

    const selected = submitBid(turn4, "player1", alternateSuit);
    expect(selected.phase).toBe("adut-selected");
    expect(selected.bidding).toEqual({ turn: 4, selectedSuit: alternateSuit, selectedBy: "player1" });
    expect(selected.players).toBe(state.players);
  });

  it("ends bidding immediately when a player accepts the face-up suit", () => {
    const state = orderedGame();
    const selected = submitBid(state, "player2", state.faceUpCard.suit);

    expect(selected.phase).toBe("adut-selected");
    expect(selected.bidding.selectedBy).toBe("player2");
    expect(selected.bidding.turn).toBe(1);
    expect(() => submitBid(selected, "player1", state.faceUpCard.suit)).toThrow(GameRuleError);
  });

  it("allows the correct face-up suit on turn two and an alternate suit on turn three", () => {
    const state = orderedGame();
    const turn2 = submitBid(state, "player2", null);
    expect(submitBid(turn2, "player1", state.faceUpCard.suit).bidding.selectedBy).toBe("player1");

    const turn3 = submitBid(turn2, "player1", null);
    const alternateSuit = SUITS.find((suit) => suit !== state.faceUpCard.suit)!;
    const selected = submitBid(turn3, "player2", alternateSuit);
    expect(selected.bidding).toEqual({ turn: 3, selectedSuit: alternateSuit, selectedBy: "player2" });
  });

  it("rejects out-of-turn players and invalid suit choices", () => {
    const state = orderedGame();
    const otherSuit = SUITS.find((suit) => suit !== state.faceUpCard.suit)!;
    expect(() => submitBid(state, "player1", state.faceUpCard.suit)).toThrow(GameRuleError);
    expect(() => submitBid(state, "player2", otherSuit)).toThrow(GameRuleError);

    const thirdTurn = submitBid(submitBid(state, "player2", null), "player1", null);
    expect(() => submitBid(thirdTurn, "player2", state.faceUpCard.suit)).toThrow(GameRuleError);
    expect(() => submitBid(thirdTurn, "player2", "not-a-suit" as Suit)).toThrow(GameRuleError);
  });

  it("does not allow passing on turn four", () => {
    const state = orderedGame();
    const turn4 = submitBid(
      submitBid(submitBid(state, "player2", null), "player1", null),
      "player2",
      null,
    );
    expect(() => submitBid(turn4, "player1", null)).toThrow("Passing is not allowed");
  });

  it("accepts any non-upcard suit on turns three and four", () => {
    const state = orderedGame();
    const turn3 = submitBid(submitBid(state, "player2", null), "player1", null);
    for (const suit of SUITS.filter((candidate) => candidate !== state.faceUpCard.suit)) {
      expect(submitBid(turn3, "player2", suit).bidding.selectedSuit).toBe(suit);
    }
  });
});
