import { createDeck } from "./cards.js";
import { shuffleDeck } from "./shuffle.js";
import type {
  BiddingTurn,
  AwardedZvanja,
  Card,
  CompletedRoundCards,
  Declaration,
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
import { compareDeclarations, detectDeclarations, getCardPointValue, getMatchWinner, settleRoundScore, updateBela } from "./scoring.js";

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
    throw new GameRuleError("Broj runde mora biti pozitivan cijeli broj.");
  }
  return roundNumber % 2 === 1 ? FIRST_DEALER : getNextDealer(FIRST_DEALER);
}

/** Deals a new round; dealer alternation is derived from the round number. */
export function dealGame(
  deck: readonly Card[] = shuffleDeck(createDeck()),
  roundNumber = 1,
  completedRounds: readonly CompletedRoundCards[] = [],
  matchScores: Readonly<Record<Player, number>> = { player1: 0, player2: 0 },
  matchWinner: Player | null = null,
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
    throw new GameRuleError("Za igru je potreban potpun špil od 32 različite karte.");
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
    originalFaceUpCard: faceUpCard,
    faceUpExchangeChecked: false,
    faceDownStack,
    bidding: { turn: 1, selectedSuit: null, selectedBy: null },
    tricksPlayed: 0,
    currentTrick: { number: 1, cards: [], ledSuit: null, winner: null },
    awaitingTrickAcknowledgement: false,
    tricksWon: { player1: 0, player2: 0 },
    trickPoints: { player1: 0, player2: 0 },
    collectedCards: { player1: [], player2: [] },
    belaProgress: {
      player1: { called: false, kingPlayed: false, queenPlayed: false, awarded: false, kingCard: null, queenCard: null },
      player2: { called: false, kingPlayed: false, queenPlayed: false, awarded: false, kingCard: null, queenCard: null },
    },
    belaPoints: { player1: 0, player2: 0 },
    declarationsByPlayer: { player1: [], player2: [] },
    declarationComparisonResult: null,
    roundScore: null,
    matchScores: { ...matchScores },
    matchWinner,
    completedRounds: [...completedRounds],
  };
}

/** Development-only transition that ends a test without implying card play or scoring. */
export function endTestRound(state: GameState): GameState {
  if (state.phase !== "bidding" && state.phase !== "playing") {
    throw new GameRuleError("Probnu rundu možete završiti samo tijekom odabira aduta ili igranja karata.");
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
    throw new GameRuleError("Prije početka nove runde završite ili izričito prekinite trenutačnu rundu.");
  }
  if (state.matchWinner) throw new GameRuleError("Partija je završena.");
  const completedRounds = [...state.completedRounds];
  if (state.phase === "round-complete") {
    if (!state.bidding.selectedSuit) throw new GameRuleError("Završena runda nema odabran adut.");
    completedRounds.push({
      roundNumber: state.roundNumber,
      dealer: state.dealer,
      adut: state.bidding.selectedSuit,
      tricksWon: { ...state.tricksWon },
      collectedCards: {
        player1: [...state.collectedCards.player1],
        player2: [...state.collectedCards.player2],
      },
      declarationsByPlayer: {
        player1: [...state.declarationsByPlayer.player1],
        player2: [...state.declarationsByPlayer.player2],
      },
      declarationComparisonResult: state.declarationComparisonResult!,
      score: state.roundScore!,
    });
  }
  return dealGame(deck, state.roundNumber + 1, completedRounds, state.matchScores, state.matchWinner);
}

/** Apply a suit selection or pass. Pass is represented by null. */
export function submitBid(state: GameState, player: Player, suit: Suit | null): GameState {
  if (state.phase !== "bidding") {
    throw new GameRuleError("Odabir aduta je već završen.");
  }

  const expectedPlayer = playerForTurn(state, state.bidding.turn);
  if (player !== expectedPlayer) {
    throw new GameRuleError(`Sada je red na igrača ${expectedPlayer === "player1" ? "1" : "2"} da odabere adut.`);
  }

  validateSuitForTurn(state.bidding.turn, state.faceUpCard.suit, suit);

  if (suit !== null) {
    const exchangedState = exchangeFaceUpSeven(state);
    const declarationsByPlayer = {
      player1: detectDeclarations([...exchangedState.players.player1.initialCards, ...exchangedState.players.player1.additionalCards]),
      player2: detectDeclarations([...exchangedState.players.player2.initialCards, ...exchangedState.players.player2.additionalCards]),
    };
    return {
      ...exchangedState,
      phase: "playing",
      currentBidder: null,
      currentPlayer: state.nonDealer,
      bidding: { ...state.bidding, selectedSuit: suit, selectedBy: player },
      declarationsByPlayer,
      declarationComparisonResult: compareDeclarations(declarationsByPlayer, state.dealer, state.nonDealer),
    };
  }

  if (state.bidding.turn === 4) {
    throw new GameRuleError("U četvrtom potezu odabir aduta je obavezan; nije moguće proći.");
  }

  return {
    ...state,
    currentBidder: playerForTurn(state, (state.bidding.turn + 1) as BiddingTurn),
    bidding: { ...state.bidding, turn: (state.bidding.turn + 1) as BiddingTurn },
  };
}

/** Exchange the original upcard for its matching Seven once, before the first trick. */
function exchangeFaceUpSeven(state: GameState): GameState {
  if (state.faceUpExchangeChecked) {
    throw new GameRuleError("Zamjena otvorene sedmice već je provjerena u ovoj rundi.");
  }

  const originalFaceUpCard = state.originalFaceUpCard;
  if (originalFaceUpCard.rank === "7") {
    return { ...state, faceUpExchangeChecked: true };
  }

  for (const player of [state.nonDealer, state.dealer]) {
    const hand = state.players[player];
    const initialIndex = hand.initialCards.findIndex(
      (card) => card.suit === originalFaceUpCard.suit && card.rank === "7",
    );
    const additionalIndex = hand.additionalCards.findIndex(
      (card) => card.suit === originalFaceUpCard.suit && card.rank === "7",
    );
    if (initialIndex < 0 && additionalIndex < 0) continue;

    const seven = initialIndex >= 0
      ? hand.initialCards[initialIndex]!
      : hand.additionalCards[additionalIndex]!;
    const updatedHand: PlayerHand = initialIndex >= 0
      ? {
          ...hand,
          initialCards: hand.initialCards.map((card, index) => index === initialIndex ? originalFaceUpCard : card),
        }
      : {
          ...hand,
          additionalCards: hand.additionalCards.map((card, index) => index === additionalIndex ? originalFaceUpCard : card),
        };

    return {
      ...state,
      players: { ...state.players, [player]: updatedHand },
      faceUpCard: seven,
      faceUpExchangeChecked: true,
    };
  }

  return { ...state, faceUpExchangeChecked: true };
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
    throw new GameRuleError("Pobjednik štiha može se odrediti tek nakon što su odigrane obje karte.");
  }
  const first = playedCards[0]!;
  const second = playedCards[1]!;
  return beatsCard(second.card, first.card, adut) ? second.player : first.player;
}

/** Legal cards on which this player can still announce their adut King/Queen pair. */
export function getBelaAnnouncementCardIds(state: GameState, player: Player): readonly string[] {
  const adut = state.bidding.selectedSuit;
  if (state.phase !== "playing" || !adut || state.currentPlayer !== player || state.belaProgress[player].called || state.belaProgress[player].awarded) return [];
  const hand = state.players[player];
  const fullHand = [...hand.initialCards, ...hand.additionalCards];
  const legalIds = new Set(getLegalCards(fullHand, state.currentTrick.cards, adut).map(({ id }) => id));
  return fullHand.filter((card) => {
    if (!legalIds.has(card.id) || card.suit !== adut || (card.rank !== "K" && card.rank !== "Q")) return false;
    const partnerRank = card.rank === "K" ? "Q" : "K";
    const partnerAlreadyPlayed = card.rank === "K"
      ? state.belaProgress[player].queenCard !== null
      : state.belaProgress[player].kingCard !== null;
    return partnerAlreadyPlayed || fullHand.some((candidate) => candidate.id !== card.id && candidate.suit === adut && candidate.rank === partnerRank);
  }).map(({ id }) => id);
}

/** Server-authoritative card play. Invalid cards and out-of-turn requests are rejected. */
export function playCard(state: GameState, player: Player, cardId: string, callBela = false): GameState {
  if (state.phase !== "playing" || !state.bidding.selectedSuit) {
    throw new GameRuleError("Karte se mogu igrati tek nakon odabira aduta.");
  }
  if (state.currentPlayer !== player) {
    throw new GameRuleError(`Sada je red na igrača ${state.currentPlayer === "player1" ? "1" : "2"} da odigra kartu.`);
  }

  const hand = state.players[player];
  const fullHand = [...hand.initialCards, ...hand.additionalCards];
  const card = fullHand.find((candidate) => candidate.id === cardId);
  if (!card) throw new GameRuleError("Ta karta nije u vašoj ruci.");

  const canCallBela = getBelaAnnouncementCardIds(state, player).includes(cardId);
  if (callBela && !canCallBela) throw new GameRuleError("Belu možete zvati samo uz adut kralja ili damu dok imate njihov par.");

  const legalCards = getLegalCards(fullHand, state.currentTrick.cards, state.bidding.selectedSuit);
  if (!legalCards.some((legalCard) => legalCard.id === cardId)) {
    throw new GameRuleError("Ta karta nije dopušten potez u ovom štihu.");
  }

  const updatedHand: PlayerHand = {
    initialCards: hand.initialCards.filter((candidate) => candidate.id !== cardId),
    additionalCards: hand.additionalCards.filter((candidate) => candidate.id !== cardId),
  };
  const players = { ...state.players, [player]: updatedHand };
  const playedCards: PlayedCard[] = [...state.currentTrick.cards, { player, card }];
  const belaResult = updateBela(state.belaProgress[player], state.belaPoints[player], card, state.bidding.selectedSuit, callBela);
  const belaProgress = { ...state.belaProgress, [player]: belaResult.progress };
  const belaPoints = { ...state.belaPoints, [player]: belaResult.points };

  if (playedCards.length === 1) {
    return {
      ...state,
      players,
      belaProgress,
      belaPoints,
      currentPlayer: otherPlayer(player),
      currentTrick: { ...state.currentTrick, cards: playedCards, ledSuit: card.suit },
    };
  }

  const winner = determineTrickWinner(playedCards, state.bidding.selectedSuit);
  const adut = state.bidding.selectedSuit;
  const tricksPlayed = state.tricksPlayed + 1;
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
  const collectedCards = {
    ...state.collectedCards,
    [winner]: [...state.collectedCards[winner], ...playedCards.map((played) => played.card)],
  };
  const trickPoints = {
    ...state.trickPoints,
    [winner]: state.trickPoints[winner] + playedCards.reduce((sum, played) => sum + getCardPointValue(played.card, adut), 0),
  };
  const roundComplete = tricksPlayed === 10;
  const roundScore = roundComplete
    ? settleRoundScore({
        caller: state.bidding.selectedBy!,
        trickPoints,
        declarationPoints: state.declarationComparisonResult?.pointsAwarded ?? { player1: 0, player2: 0 },
        belaPoints,
        tricksWon,
        lastTrickWinner: winner,
      })
    : null;
  const matchScores = roundScore
    ? { player1: state.matchScores.player1 + roundScore.matchPointsAwarded.player1, player2: state.matchScores.player2 + roundScore.matchPointsAwarded.player2 }
    : state.matchScores;

  return {
    ...state,
    players,
    phase: roundComplete ? "round-complete" : "trick-complete",
    currentPlayer: null,
    tricksPlayed,
    currentTrick: { ...state.currentTrick, cards: playedCards, winner },
    awaitingTrickAcknowledgement: true,
    tricksWon,
    trickPoints,
    collectedCards,
    belaProgress,
    belaPoints,
    roundScore,
    matchScores,
    matchWinner: roundComplete ? getMatchWinner(matchScores) : state.matchWinner,
  };
}

/** Keep the visible trick until acknowledged; its winner then leads the next trick. */
export function acknowledgeTrick(state: GameState): GameState {
  if (
    !state.awaitingTrickAcknowledgement ||
    (state.phase !== "trick-complete" && state.phase !== "round-complete") ||
    !state.currentTrick.winner
  ) {
    throw new GameRuleError("Nema završenog štiha koji čeka potvrdu.");
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

function ordinaryDeclarationName(declaration: Declaration): string {
  if (declaration.kind === "sequence") {
    const sequenceNames: Readonly<Record<number, string>> = {
      3: "Terca",
      4: "Kvarta",
      5: "Kvinta",
      6: "Seksta",
      7: "Septima",
      8: "Oktava",
    };
    return sequenceNames[declaration.sequenceLength ?? 0] ?? "Niz";
  }

  const rankName: Readonly<Record<Rank, string>> = {
    "7": "sedmice", "8": "osmice", "9": "devetke", "10": "desetke",
    J: "dečke", Q: "dame", K: "kraljeve", A: "aseve",
  };
  return `Četiri ${rankName[declaration.rank ?? "7"]}`;
}

function getAwardedZvanja(state: GameState): Readonly<Record<Player, readonly AwardedZvanja[]>> {
  const result: Record<Player, AwardedZvanja[]> = { player1: [], player2: [] };
  for (const player of ["player1", "player2"] as const) {
    const ordinary = state.declarationComparisonResult?.scoredByPlayer[player] ?? [];
    for (const declaration of ordinary) {
      if (declaration.points <= 0) continue;
      result[player].push({
        id: `ordinary:${declaration.cards.map(({ id }) => id).sort().join(":")}`,
        player,
        name: ordinaryDeclarationName(declaration),
        points: declaration.points,
        cards: declaration.cards,
        kind: "ordinary",
      });
    }

    const bela = state.belaProgress[player];
    if (bela.awarded && state.belaPoints[player] > 0 && bela.kingCard && bela.queenCard) {
      result[player].push({
        id: `bela:${bela.kingCard.id}:${bela.queenCard.id}`,
        player,
        name: "Bela",
        points: state.belaPoints[player],
        cards: [bela.kingCard, bela.queenCard],
        kind: "bela",
      });
    }
  }
  return result;
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
    belaAnnouncementCardIds: getBelaAnnouncementCardIds(state, viewer),
    tricksPlayed: state.tricksPlayed,
    currentTrick: state.currentTrick,
    awaitingTrickAcknowledgement: state.awaitingTrickAcknowledgement,
    tricksWon: state.tricksWon,
    trickPoints: state.trickPoints,
    zvanjaPointsAwarded: {
      player1: (state.declarationComparisonResult?.pointsAwarded.player1 ?? 0) + state.belaPoints.player1,
      player2: (state.declarationComparisonResult?.pointsAwarded.player2 ?? 0) + state.belaPoints.player2,
    },
    awardedZvanja: getAwardedZvanja(state),
    collectedCardCounts: {
      player1: state.collectedCards.player1.length,
      player2: state.collectedCards.player2.length,
    },
    belaPoints: state.belaPoints,
    declarationComparisonResult: state.phase === "round-complete" ? state.declarationComparisonResult : null,
    roundScore: state.phase === "round-complete" ? state.roundScore : null,
    matchScores: state.matchScores,
    matchWinner: state.matchWinner,
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
    throw new GameRuleError("Odabrana boja aduta nije valjana.");
  }

  if ((turn === 1 || turn === 2) && suit !== faceUpSuit) {
    throw new GameRuleError("U prvom i drugom potezu možete odabrati samo boju otvorene karte.");
  }
  if ((turn === 3 || turn === 4) && suit === faceUpSuit) {
    throw new GameRuleError("U trećem i četvrtom potezu odaberite boju različitu od boje otvorene karte.");
  }
}
