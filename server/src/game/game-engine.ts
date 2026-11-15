import { createDeck } from "./cards.js";
import { shuffleDeck } from "./shuffle.js";
import type {
  BiddingTurn,
  Card,
  CompletedRoundCards,
  GameState,
  Player,
  PlayerGameView,
  PlayerHand,
  PlayerHandView,
  PlayedCard,
  Rank,
  Suit,
  TrickState,
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
  completedRounds: readonly CompletedRoundCards[] = [],
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
    currentPlayer: null,
    phase: "bidding",
    players,
    faceUpCard,
    faceDownStack,
    bidding: { turn: 1, selectedSuit: null, selectedBy: null },
    tricksPlayed: 0,
    currentTrick: { number: 1, cards: [], ledSuit: null, winner: null },
    awaitingTrickAcknowledgement: false,
    tricksWon: { player1: 0, player2: 0 },
    collectedCards: { player1: [], player2: [] },
    completedRounds: [...completedRounds],
  };
}

/** Development-only transition that ends a test without implying card play or scoring. */
export function endTestRound(state: GameState): GameState {
  if (state.phase !== "bidding" && state.phase !== "playing") {
    throw new GameRuleError("A test round can only be ended during bidding or card play.");
  }
  return {
    ...state,
    phase: "test-round-ended",
    currentBidder: null,
    currentPlayer: null,
    awaitingTrickAcknowledgement: false,
  };
}

/** Start exactly one next round after the previous round was marked complete. */
export function startNextRound(
  state: GameState,
  deck: readonly Card[] = shuffleDeck(createDeck()),
): GameState {
  if (
    (state.phase !== "round-complete" && state.phase !== "test-round-ended") ||
    state.awaitingTrickAcknowledgement
  ) {
    throw new GameRuleError("The current round must be complete or explicitly ended before starting the next round.");
  }
  const completedRounds = [...state.completedRounds];
  if (state.phase === "round-complete") {
    if (!state.bidding.selectedSuit) throw new GameRuleError("Completed round is missing its adut suit.");
    completedRounds.push({
      roundNumber: state.roundNumber,
      dealer: state.dealer,
      adut: state.bidding.selectedSuit,
      tricksWon: { ...state.tricksWon },
      collectedCards: {
        player1: [...state.collectedCards.player1],
        player2: [...state.collectedCards.player2],
      },
    });
  }
  return dealGame(deck, state.roundNumber + 1, completedRounds);
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
      phase: "playing",
      currentBidder: null,
      currentPlayer: state.nonDealer,
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

/** Stronger ranks have a larger strength value within their own suit. */
export function getCardRankStrength(rank: Rank, suit: Suit, adut: Suit): number {
  const trumpStrength: Readonly<Record<Rank, number>> = {
    "7": 1, "8": 2, "9": 7, "10": 5, J: 8, Q: 3, K: 4, A: 6,
  };
  const nonTrumpStrength: Readonly<Record<Rank, number>> = {
    "7": 1, "8": 2, "9": 3, "10": 7, J: 4, Q: 5, K: 6, A: 8,
  };
  return (suit === adut ? trumpStrength : nonTrumpStrength)[rank];
}

/** Returns a fresh list of legal cards for the player responding to the current trick. */
export function getLegalCards(
  hand: readonly Card[],
  playedCards: readonly PlayedCard[],
  adut: Suit,
): Card[] {
  if (playedCards.length === 0) return [...hand];
  if (playedCards.length !== 1) return [];

  const ledCard = playedCards[0]!.card;
  const followingSuit = hand.filter((card) => card.suit === ledCard.suit);
  if (followingSuit.length > 0) {
    const beatingFollowingSuit = followingSuit.filter((card) => beatsCard(card, ledCard, adut));
    return beatingFollowingSuit.length > 0 ? beatingFollowingSuit : followingSuit;
  }

  const trumps = hand.filter((card) => card.suit === adut);
  if (trumps.length === 0) return [...hand];

  if (ledCard.suit === adut) {
    const higherTrumps = trumps.filter((card) => beatsCard(card, ledCard, adut));
    return higherTrumps.length > 0 ? higherTrumps : trumps;
  }

  return trumps;
}

/** Compare the two cards of a completed trick and return its winner. */
export function determineTrickWinner(playedCards: readonly PlayedCard[], adut: Suit): Player {
  if (playedCards.length !== 2) {
    throw new GameRuleError("A trick winner can only be determined after two cards are played.");
  }
  const first = playedCards[0]!;
  const second = playedCards[1]!;
  return beatsCard(second.card, first.card, adut) ? second.player : first.player;
}

/** Server-authoritative card play. Invalid cards and out-of-turn requests are rejected. */
export function playCard(state: GameState, player: Player, cardId: string): GameState {
  if (state.phase !== "playing" || !state.bidding.selectedSuit) {
    throw new GameRuleError("Cards can only be played after adut has been selected.");
  }
  if (state.currentPlayer !== player) {
    throw new GameRuleError(`It is ${state.currentPlayer ?? "no player's"} turn to play.`);
  }

  const hand = state.players[player];
  const fullHand = [...hand.initialCards, ...hand.additionalCards];
  const card = fullHand.find((candidate) => candidate.id === cardId);
  if (!card) throw new GameRuleError("That card is not in this player's hand.");

  const legalCards = getLegalCards(fullHand, state.currentTrick.cards, state.bidding.selectedSuit);
  if (!legalCards.some((legalCard) => legalCard.id === cardId)) {
    throw new GameRuleError("That card is not a legal play for this trick.");
  }

  const updatedHand: PlayerHand = {
    initialCards: hand.initialCards.filter((candidate) => candidate.id !== cardId),
    additionalCards: hand.additionalCards.filter((candidate) => candidate.id !== cardId),
  };
  const players = { ...state.players, [player]: updatedHand };
  const playedCards: PlayedCard[] = [...state.currentTrick.cards, { player, card }];

  if (playedCards.length === 1) {
    return {
      ...state,
      players,
      currentPlayer: otherPlayer(player),
      currentTrick: { ...state.currentTrick, cards: playedCards, ledSuit: card.suit },
    };
  }

  const winner = determineTrickWinner(playedCards, state.bidding.selectedSuit);
  const tricksPlayed = state.tricksPlayed + 1;
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
  const collectedCards = {
    ...state.collectedCards,
    [winner]: [...state.collectedCards[winner], ...playedCards.map((played) => played.card)],
  };

  return {
    ...state,
    players,
    phase: tricksPlayed === 10 ? "round-complete" : "trick-complete",
    currentPlayer: null,
    tricksPlayed,
    currentTrick: { ...state.currentTrick, cards: playedCards, winner },
    awaitingTrickAcknowledgement: true,
    tricksWon,
    collectedCards,
  };
}

/** Keep the visible trick until acknowledged; its winner then leads the next trick. */
export function acknowledgeTrick(state: GameState): GameState {
  if (
    !state.awaitingTrickAcknowledgement ||
    (state.phase !== "trick-complete" && state.phase !== "round-complete") ||
    !state.currentTrick.winner
  ) {
    throw new GameRuleError("There is no completed trick awaiting acknowledgement.");
  }

  if (state.tricksPlayed === 10) {
    return { ...state, awaitingTrickAcknowledgement: false };
  }

  const winner = state.currentTrick.winner;
  return {
    ...state,
    phase: "playing",
    currentPlayer: winner,
    awaitingTrickAcknowledgement: false,
    currentTrick: {
      number: state.tricksPlayed + 1,
      cards: [],
      ledSuit: null,
      winner: null,
    },
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
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    viewer,
    hands,
    faceUpCard: state.faceUpCard,
    faceDownStackCount: state.faceDownStack.length,
    bidding: state.bidding,
    allowedBids: getAllowedBids(state, viewer),
    legalCardIds: state.phase === "playing" && state.currentPlayer === viewer && state.bidding.selectedSuit
      ? getLegalCards(
          [...ownHand.initialCards, ...ownHand.additionalCards],
          state.currentTrick.cards,
          state.bidding.selectedSuit,
        ).map(({ id }) => id)
      : [],
    tricksPlayed: state.tricksPlayed,
    currentTrick: state.currentTrick,
    awaitingTrickAcknowledgement: state.awaitingTrickAcknowledgement,
    tricksWon: state.tricksWon,
    collectedCardCounts: {
      player1: state.collectedCards.player1.length,
      player2: state.collectedCards.player2.length,
    },
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

function beatsCard(candidate: Card, current: Card, adut: Suit): boolean {
  if (candidate.suit !== current.suit) {
    return candidate.suit === adut && current.suit !== adut;
  }
  return getCardRankStrength(candidate.rank, candidate.suit, adut) >
    getCardRankStrength(current.rank, current.suit, adut);
}

function otherPlayer(player: Player): Player {
  return player === "player1" ? "player2" : "player1";
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
