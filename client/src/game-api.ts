export const SUITS = ["srce", "tikva", "žir", "zelje"] as const;

export type Suit = (typeof SUITS)[number];
export type Player = "player1" | "player2";
export type GamePhase = "bidding" | "adut-selected" | "round-complete" | "test-round-ended";

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
}

export interface PlayerGameView {
  readonly roundNumber: number;
  readonly dealer: Player;
  readonly nonDealer: Player;
  readonly currentBidder: Player | null;
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
}

export type LocalMatchSnapshot =
  | { readonly matchExists: false }
  | {
      readonly matchExists: true;
      readonly activePlayer: Player;
      readonly scores: Readonly<Record<Player, number>>;
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
    throw new Error("Could not reach the game server. Check that the backend is running, then retry.");
  }

  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error ?? `Game server returned ${response.status}.`);
  }
  return payload;
}

export const localGameApi = {
  getMatch: () => request<LocalMatchSnapshot>("/match"),
  newMatch: () => request<LocalMatchSnapshot>("/match", "POST"),
  startNextRound: () => request<LocalMatchSnapshot>("/match/round", "POST"),
  switchPlayer: () => request<LocalMatchSnapshot>("/match/switch-player", "POST"),
  submitBid: (suit: Suit | null) => request<LocalMatchSnapshot>("/match/bid", "POST", { suit }),
  endTestRound: () => request<LocalMatchSnapshot>("/match/end-test-round", "POST"),
};
