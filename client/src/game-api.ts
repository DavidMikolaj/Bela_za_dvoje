export const SUITS = ["srce", "tikva", "žir", "zelje"] as const;

export type Suit = (typeof SUITS)[number];
export type Player = "player1" | "player2";
export type GamePhase = "bidding" | "playing" | "trick-complete" | "round-complete" | "test-round-ended";

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
}

export interface Declaration {
  readonly kind: "sequence" | "four-of-kind";
  readonly points: number;
  readonly cards: readonly Card[];
  readonly sequenceLength: number | null;
  readonly highestRank: Card["rank"] | null;
  readonly rank: Card["rank"] | null;
}

export interface AwardedZvanja {
  readonly id: string;
  readonly player: Player;
  readonly name: string;
  readonly points: number;
  readonly cards: readonly Card[];
  readonly kind: "ordinary" | "bela";
}

export interface RoundScoreBreakdown {
  readonly caller: Player;
  readonly contractSucceeded: boolean;
  readonly trickPoints: Readonly<Record<Player, number>>;
  readonly declarationPoints: Readonly<Record<Player, number>>;
  readonly belaPoints: Readonly<Record<Player, number>>;
  readonly lastTrickBonus: Readonly<Record<Player, number>>;
  readonly stigljaBonus: Readonly<Record<Player, number>>;
  readonly roundTotals: Readonly<Record<Player, number>>;
  readonly matchPointsAwarded: Readonly<Record<Player, number>>;
}

export interface DeclarationComparisonResult {
  readonly winner: Player | null;
  readonly pointsAwarded: Readonly<Record<Player, number>>;
  readonly scoredByPlayer: Readonly<Record<Player, readonly Declaration[]>>;
}

export interface PlayerGameView {
  readonly roundNumber: number;
  readonly dealer: Player;
  readonly nonDealer: Player;
  readonly currentBidder: Player | null;
  readonly currentPlayer: Player | null;
  readonly phase: GamePhase;
  readonly viewer: Player;
  readonly hands: Readonly<Record<Player, {
    readonly cards: readonly Card[];
    readonly cardCount: number;
    readonly hiddenCardCount: number;
  }>>;
  readonly faceUpCard: Card;
  readonly faceDownStackCount: number;
  readonly bidding: {
    readonly turn: 1 | 2 | 3 | 4;
    readonly selectedSuit: Suit | null;
    readonly selectedBy: Player | null;
  };
  readonly allowedBids: readonly (Suit | null)[];
  readonly legalCardIds: readonly string[];
  readonly belaAnnouncementCardIds: readonly string[];
  readonly tricksPlayed: number;
  readonly currentTrick: {
    readonly number: number;
    readonly cards: readonly { readonly player: Player; readonly card: Card }[];
    readonly ledSuit: Suit | null;
    readonly winner: Player | null;
  };
  readonly awaitingTrickAcknowledgement: boolean;
  readonly tricksWon: Readonly<Record<Player, number>>;
  readonly collectedCardCounts: Readonly<Record<Player, number>>;
  readonly trickPoints: Readonly<Record<Player, number>>;
  readonly zvanjaPointsAwarded: Readonly<Record<Player, number>>;
  readonly awardedZvanja: Readonly<Record<Player, readonly AwardedZvanja[]>>;
  readonly belaPoints: Readonly<Record<Player, number>>;
  readonly declarationComparisonResult: DeclarationComparisonResult | null;
  readonly roundScore: RoundScoreBreakdown | null;
  readonly matchScores: Readonly<Record<Player, number>>;
  readonly matchWinner: Player | null;
}

export type LocalMatchSnapshot =
  | { readonly matchExists: false }
  | {
      readonly matchExists: true;
      readonly activePlayer: Player;
      readonly scores: Readonly<Record<Player, number>>;
      readonly trickTransitionAt: number | null;
      /** Contains only activePlayer's hand cards; opponent cards are omitted server-side. */
      readonly view: PlayerGameView;
    };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/dev${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Nije moguće povezati se s poslužiteljem igre. Provjerite radi li poslužitelj pa pokušajte ponovno.");
  }

  let payload: { error?: string } & T;
  try {
    payload = await response.json() as { error?: string } & T;
  } catch {
    throw new Error("Poslužitelj je vratio neispravan odgovor.");
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `Poslužitelj igre vratio je pogrešku ${response.status}.`);
  }
  return payload;
}

export const localGameApi = {
  getMatch: () => request<LocalMatchSnapshot>("/match"),
  newMatch: () => request<LocalMatchSnapshot>("/match", "POST"),
  startNextRound: () => request<LocalMatchSnapshot>("/match/round", "POST"),
  switchPlayer: () => request<LocalMatchSnapshot>("/match/switch-player", "POST"),
  submitBid: (suit: Suit | null) => request<LocalMatchSnapshot>("/match/bid", "POST", { suit }),
  playCard: (cardId: string, callBela: boolean) => request<LocalMatchSnapshot>("/match/play", "POST", { cardId, callBela }),
  endTestRound: () => request<LocalMatchSnapshot>("/match/end-test-round", "POST"),
};
