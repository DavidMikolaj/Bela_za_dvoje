import { createDeck } from "./cards.js";
import { shuffleDeck } from "./shuffle.js";
import type {
  BiddingTurn,
  Card,
  GameState,
  Player,
  PlayerGameView,
  PlayerHand,
  PlayerHandView,
  Suit,
} from "./types.js";
import { SUITS } from "./types.js";

export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}

const FIRST_DEALER: Player = "player1";

export function getNextDealer(currentDealer: Player): Player {
  return currentDealer === "player1" ? "player2" : "player1";
}

export function getDealerForRound(roundNumber: number): Player {
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new GameRuleError("Round number must be a positive integer.");
  }
  return roundNumber % 2 === 1 ? FIRST_DEALER : getNextDealer(FIRST_DEALER);
}

/** Deals a new round; dealer alternation is derived from the round number. */
export function dealGame(
  deck: readonly Card[] = shuffleDeck(createDeck()),
  roundNumber = 1,
): GameState {
  const dealer = getDealerForRound(roundNumber);
  const nonDealer = getNextDealer(dealer);
  const canonicalDeck = createDeck();
  const canonicalCards = new Map(canonicalDeck.map((card) => [card.id, card]));
  if (
    deck.length !== 32 ||
    new Set(deck.map(({ id }) => id)).size !== 32 ||
    deck.some((card) => {
      const canonicalCard = canonicalCards.get(card.id);
      return !canonicalCard || card.suit !== canonicalCard.suit || card.rank !== canonicalCard.rank;
    })
  ) {
    throw new GameRuleError("A game requires a complete deck of 32 unique cards.");
  }

  const cards = [...deck];
  let nextCard = 0;
  const take = (count: number): Card[] => {
    const hand = cards.slice(nextCard, nextCard + count);
    nextCard += count;
    return hand;
  };

  // The non-dealer receives every packet first, regardless of player identity.
  const nonDealerFirstPacket = take(3);
  const dealerFirstPacket = take(3);
  const nonDealerSecondPacket = take(3);
  const dealerSecondPacket = take(3);
  const faceUpCard = take(1)[0]!;
  const nonDealerAdditional = take(4);
  const dealerAdditional = take(4);
  const faceDownStack = take(11);

  const players = Object.create(null) as Record<Player, PlayerHand>;
  players[nonDealer] = {
    initialCards: [...nonDealerFirstPacket, ...nonDealerSecondPacket],
    additionalCards: nonDealerAdditional,
  };
  players[dealer] = {
    initialCards: [...dealerFirstPacket, ...dealerSecondPacket],
    additionalCards: dealerAdditional,
  };

  return {
    roundNumber,
    dealer,
    nonDealer,
    currentBidder: nonDealer,
    phase: "bidding",
    players,
    faceUpCard,
    faceDownStack,
    bidding: { turn: 1, selectedSuit: null, selectedBy: null },
  };
}

/** Mark a round complete once the caller's round-completion criteria are met. */
export function completeRound(state: GameState): GameState {
  if (state.phase !== "adut-selected") {
    throw new GameRuleError("A round can only be completed after adut is selected.");
  }
  return { ...state, phase: "round-complete", currentBidder: null };
}

/** Development-only transition that ends a test without implying card play or scoring. */
export function endTestRound(state: GameState): GameState {
  if (state.phase === "round-complete" || state.phase === "test-round-ended") {
    throw new GameRuleError("This round has already ended.");
  }
  return { ...state, phase: "test-round-ended", currentBidder: null };
}

/** Start exactly one next round after the previous round was marked complete. */
export function startNextRound(
  state: GameState,
  deck: readonly Card[] = shuffleDeck(createDeck()),
): GameState {
  if (state.phase !== "round-complete" && state.phase !== "test-round-ended") {
    throw new GameRuleError("The current round must be complete or explicitly ended before starting the next round.");
  }
  return dealGame(deck, state.roundNumber + 1);
}

/** Apply a suit selection or pass. Pass is represented by null. */
export function submitBid(state: GameState, player: Player, suit: Suit | null): GameState {
  if (state.phase !== "bidding") {
    throw new GameRuleError("Bidding has already ended.");
  }

  const expectedPlayer = playerForTurn(state, state.bidding.turn);
  if (player !== expectedPlayer) {
    throw new GameRuleError(`It is ${expectedPlayer}'s bidding turn.`);
  }

  validateSuitForTurn(state.bidding.turn, state.faceUpCard.suit, suit);

  if (suit !== null) {
    return {
      ...state,
      phase: "adut-selected",
      currentBidder: null,
      bidding: { ...state.bidding, selectedSuit: suit, selectedBy: player },
    };
  }

  if (state.bidding.turn === 4) {
    throw new GameRuleError("Passing is not allowed on bidding turn 4.");
  }

  return {
    ...state,
    currentBidder: playerForTurn(state, (state.bidding.turn + 1) as BiddingTurn),
    bidding: { ...state.bidding, turn: (state.bidding.turn + 1) as BiddingTurn },
  };
}

/** Returns only information that the requested player is allowed to see. */
export function getPlayerView(state: GameState, viewer: Player): PlayerGameView {
  const ownHand = state.players[viewer];
  const adutSelected = state.bidding.selectedSuit !== null;
  const ownCards = !adutSelected
    ? ownHand.initialCards
    : [...ownHand.initialCards, ...ownHand.additionalCards];
  const ownHiddenCount = adutSelected ? 0 : ownHand.additionalCards.length;
  const otherPlayer: Player = viewer === "player1" ? "player2" : "player1";
  const otherHand = state.players[otherPlayer];
  const otherCardCount = otherHand.initialCards.length + otherHand.additionalCards.length;
  const ownView: PlayerHandView = {
    cards: ownCards,
    cardCount: ownCards.length,
    hiddenCardCount: ownHiddenCount,
  };
  const otherView: PlayerHandView = {
    cards: [],
    cardCount: otherCardCount,
    hiddenCardCount: otherCardCount,
  };
  const hands: Record<Player, PlayerHandView> = viewer === "player1"
    ? { player1: ownView, player2: otherView }
    : { player1: otherView, player2: ownView };

  return {
    roundNumber: state.roundNumber,
    dealer: state.dealer,
    nonDealer: state.nonDealer,
    currentBidder: state.currentBidder,
    phase: state.phase,
    viewer,
    hands,
    faceUpCard: state.faceUpCard,
    faceDownStackCount: state.faceDownStack.length,
    bidding: state.bidding,
    allowedBids: getAllowedBids(state, viewer),
  };
}

export function getAllowedBids(state: GameState, player: Player): readonly (Suit | null)[] {
  if (state.phase !== "bidding" || state.currentBidder !== player) return [];

  if (state.bidding.turn === 1 || state.bidding.turn === 2) {
    return [state.faceUpCard.suit, null];
  }

  const alternateSuits = SUITS.filter((suit) => suit !== state.faceUpCard.suit);
  return state.bidding.turn === 3 ? [...alternateSuits, null] : alternateSuits;
}

function playerForTurn(state: GameState, turn: BiddingTurn): Player {
  return turn === 1 || turn === 3 ? state.nonDealer : state.dealer;
}

function validateSuitForTurn(turn: BiddingTurn, faceUpSuit: Suit, suit: Suit | null): void {
  if (suit === null) return;

  if (!(SUITS as readonly string[]).includes(suit)) {
    throw new GameRuleError("The selected adut suit is invalid.");
  }

  if ((turn === 1 || turn === 2) && suit !== faceUpSuit) {
    throw new GameRuleError("On bidding turns 1 and 2, only the face-up suit can be selected.");
  }
  if ((turn === 3 || turn === 4) && suit === faceUpSuit) {
    throw new GameRuleError("On bidding turns 3 and 4, select a suit other than the face-up suit.");
  }
}
