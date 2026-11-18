import { io, type Socket } from "socket.io-client";
import type { PlayerGameView, Suit } from "./game-api";

export type RoomPlayer = "player1" | "player2";
export type RoomStatus = "waiting" | "ready" | "started";

export interface PublicRoomState {
  readonly code: string;
  readonly createdAt: string;
  readonly creator: "player1";
  readonly status: RoomStatus;
  readonly players: Readonly<Record<RoomPlayer, { readonly assigned: boolean; readonly connected: boolean }>>;
}

export interface RoomCredential {
  readonly room: PublicRoomState;
  readonly player: RoomPlayer;
  readonly sessionToken: string;
}

export interface RoomStartNotice {
  readonly roomCode: string;
  readonly startedAt: string;
}

export interface RoomClosedNotice {
  readonly roomCode: string;
  readonly closed: true;
  readonly reason: "creator-left";
}

export interface RoomError {
  readonly code: string;
  readonly message: string;
}

export interface MultiplayerGameState {
  readonly matchId: string;
  readonly view: PlayerGameView;
  readonly room: PublicRoomState;
  readonly nextRoundReady: Readonly<Record<RoomPlayer, boolean>>;
  readonly newMatchReady: Readonly<Record<RoomPlayer, boolean>>;
}

export type RoomAck<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: RoomError };

export interface ClientToServerEvents {
  "room:create": (ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:join": (payload: { readonly roomCode: string }, ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:resume": (payload: { readonly sessionToken: string }, ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:leave": (ack: (response: RoomAck<{ readonly left: true }>) => void) => void;
  "room:start": (ack: (response: RoomAck<RoomStartNotice & { readonly room: PublicRoomState }>) => void) => void;
  "game:get-state": (ack: (response: RoomAck<MultiplayerGameState>) => void) => void;
  "game:bid": (payload: { readonly matchId: string; readonly suit: Suit | null }, ack: (response: RoomAck<{ readonly accepted: true }>) => void) => void;
  "game:play-card": (payload: { readonly matchId: string; readonly cardId: string; readonly callBela: boolean }, ack: (response: RoomAck<{ readonly accepted: true }>) => void) => void;
  "game:next-round": (payload: { readonly matchId: string; readonly roundNumber: number }, ack: (response: RoomAck<{ readonly accepted: true; readonly waitingForOpponent: boolean }>) => void) => void;
  "game:new-match": (payload: { readonly matchId: string }, ack: (response: RoomAck<{ readonly accepted: true; readonly waitingForOpponent: boolean }>) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: PublicRoomState | RoomClosedNotice) => void;
  "room:started": (notice: RoomStartNotice) => void;
  "game:state": (state: MultiplayerGameState) => void;
}

export type MultiplayerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const ROOM_SESSION_STORAGE_KEY = "bela.multiplayer.session.v1";

export function createMultiplayerSocket(): MultiplayerSocket {
  // Resolve against the current page origin so Vite's proxy, reverse proxies, and HTTPS tunnels work alike.
  return io({ autoConnect: true, reconnection: true });
}

export function requestRoom<T>(send: (ack: (response: RoomAck<T>) => void) => void): Promise<RoomAck<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: { code: "TIMEOUT", message: "Poslužitelj nije odgovorio. Provjerite vezu i pokušajte ponovno." } });
    }, 8000);
    send((response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(response);
    });
  });
}
