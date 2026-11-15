export const SUITS = ["srce", "tikva", "žir", "zelje"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type Player = "player1" | "player2";
export type BiddingTurn = 1 | 2 | 3 | 4;
export type GamePhase = "bidding" | "adut-selected" | "round-complete" | "test-round-ended";

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

/** Complete server-side state. Do not send this object to a player. */
export interface GameState {
  readonly roundNumber: number;
  readonly dealer: Player;
  readonly nonDealer: Player;
  /** Null once adut has been selected or the round is complete. */
  readonly currentBidder: Player | null;
  readonly phase: GamePhase;
  readonly players: Readonly<Record<Player, PlayerHand>>;
  readonly faceUpCard: Card;
  /** The eleven cards stacked face-down over the face-up card. */
  readonly faceDownStack: readonly Card[];
  readonly bidding: BiddingState;
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
  readonly phase: GamePhase;
  readonly viewer: Player;
  readonly hands: Readonly<Record<Player, PlayerHandView>>;
  readonly faceUpCard: Card;
  readonly faceDownStackCount: number;
  readonly bidding: BiddingState;
  /** Legal choices for this viewer only; empty when it is not their turn. */
  readonly allowedBids: readonly (Suit | null)[];
}
