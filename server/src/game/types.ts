export const SUITS = ["srce", "tikva", "žir", "zelje"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type Player = "player1" | "player2";
export type BiddingTurn = 1 | 2 | 3 | 4;
export type GamePhase = "bidding" | "playing" | "trick-complete" | "round-complete" | "test-round-ended";

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface PlayerHand {
  /** The six cards dealt before the face-up card is revealed. */
  readonly initialCards: readonly Card[];
  /** The four cards dealt face-down and hidden until adut is selected. */
  readonly additionalCards: readonly Card[];
}

export interface BiddingState {
  readonly turn: BiddingTurn;
  readonly selectedSuit: Suit | null;
  readonly selectedBy: Player | null;
}

export type ZvanjeKind = "sequence" | "four-of-kind";

export interface Zvanje {
  readonly kind: ZvanjeKind;
  readonly points: number;
  readonly cards: readonly Card[];
  readonly sequenceLength: number | null;
  readonly highestRank: Rank | null;
  readonly rank: Rank | null;
}

export interface OrdinaryZvanjaResult {
  readonly winner: Player | null;
  readonly pointsAwarded: Readonly<Record<Player, number>>;
  readonly scoredByPlayer: Readonly<Record<Player, readonly Zvanje[]>>;
}

export interface BelaProgress {
  readonly kingPlayed: boolean;
  readonly queenPlayed: boolean;
  readonly awarded: boolean;
}

export interface RoundScoreBreakdown {
  readonly caller: Player;
  readonly contractSucceeded: boolean;
  readonly trickPoints: Readonly<Record<Player, number>>;
  readonly ordinaryZvanjaPoints: Readonly<Record<Player, number>>;
  readonly belaPoints: Readonly<Record<Player, number>>;
  readonly lastTrickBonus: Readonly<Record<Player, number>>;
  readonly stigljaBonus: Readonly<Record<Player, number>>;
  readonly roundTotals: Readonly<Record<Player, number>>;
  readonly matchPointsAwarded: Readonly<Record<Player, number>>;
}

export interface PlayedCard {
  readonly player: Player;
  readonly card: Card;
}

export interface TrickState {
  readonly number: number;
  readonly cards: readonly PlayedCard[];
  readonly ledSuit: Suit | null;
  readonly winner: Player | null;
}

export interface CompletedRoundCards {
  readonly roundNumber: number;
  readonly dealer: Player;
  readonly adut: Suit;
  readonly tricksWon: Readonly<Record<Player, number>>;
  readonly collectedCards: Readonly<Record<Player, readonly Card[]>>;
  readonly ordinaryZvanjaByPlayer: Readonly<Record<Player, readonly Zvanje[]>>;
  readonly ordinaryZvanjaResult: OrdinaryZvanjaResult;
  readonly score: RoundScoreBreakdown;
}

/** Complete server-side state. Do not send this object to a player. */
export interface GameState {
  readonly roundNumber: number;
  readonly dealer: Player;
  readonly nonDealer: Player;
  /** Null once adut has been selected or the round is complete. */
  readonly currentBidder: Player | null;
  readonly currentPlayer: Player | null;
  readonly phase: GamePhase;
  readonly players: Readonly<Record<Player, PlayerHand>>;
  readonly faceUpCard: Card;
  /** Original upcard retained privately for the once-per-round Seven exchange. */
  readonly originalFaceUpCard: Card;
  readonly faceUpExchangeChecked: boolean;
  /** The eleven cards stacked face-down over the face-up card. */
  readonly faceDownStack: readonly Card[];
  readonly bidding: BiddingState;
  readonly tricksPlayed: number;
  readonly currentTrick: TrickState;
  readonly awaitingTrickAcknowledgement: boolean;
  readonly tricksWon: Readonly<Record<Player, number>>;
  readonly trickPoints: Readonly<Record<Player, number>>;
  /** Cards won in tricks this round; retained for later scoring work. */
  readonly collectedCards: Readonly<Record<Player, readonly Card[]>>;
  readonly belaProgress: Readonly<Record<Player, BelaProgress>>;
  readonly belaPoints: Readonly<Record<Player, number>>;
  /** Zvanja are detected after the upcard exchange; kept private until round end. */
  readonly ordinaryZvanjaByPlayer: Readonly<Record<Player, readonly Zvanje[]>>;
  readonly ordinaryZvanjaResult: OrdinaryZvanjaResult | null;
  readonly roundScore: RoundScoreBreakdown | null;
  readonly matchScores: Readonly<Record<Player, number>>;
  readonly matchWinner: Player | null;
  /** Completed played rounds are retained when the next deal begins. */
  readonly completedRounds: readonly CompletedRoundCards[];
}

export interface PlayerHandView {
  /** Empty for the other player. */
  readonly cards: readonly Card[];
  readonly cardCount: number;
  /** Number of the requesting player's cards hidden from them at this phase. */
  readonly hiddenCardCount: number;
}

/** Safe player-facing projection; it never contains another player's cards or the face-down stack. */
export interface PlayerGameView {
  readonly roundNumber: number;
  readonly dealer: Player;
  readonly nonDealer: Player;
  readonly currentBidder: Player | null;
  readonly currentPlayer: Player | null;
  readonly phase: GamePhase;
  readonly viewer: Player;
  readonly hands: Readonly<Record<Player, PlayerHandView>>;
  readonly faceUpCard: Card;
  readonly faceDownStackCount: number;
  readonly bidding: BiddingState;
  /** Legal choices for this viewer only; empty when it is not their turn. */
  readonly allowedBids: readonly (Suit | null)[];
  readonly legalCardIds: readonly string[];
  readonly tricksPlayed: number;
  readonly currentTrick: TrickState;
  readonly awaitingTrickAcknowledgement: boolean;
  readonly tricksWon: Readonly<Record<Player, number>>;
  readonly trickPoints: Readonly<Record<Player, number>>;
  readonly collectedCardCounts: Readonly<Record<Player, number>>;
  readonly belaPoints: Readonly<Record<Player, number>>;
  /** Opponent zvanja are withheld until the round has ended. */
  readonly ordinaryZvanjaByPlayer: Readonly<Record<Player, readonly Zvanje[]>>;
  readonly ordinaryZvanjaResult: OrdinaryZvanjaResult | null;
  readonly roundScore: RoundScoreBreakdown | null;
  readonly matchScores: Readonly<Record<Player, number>>;
  readonly matchWinner: Player | null;
}
