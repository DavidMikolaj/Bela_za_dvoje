import type { Server, Socket } from "socket.io";
import { SUITS, type Player, type Suit } from "../game/types.js";
import { MultiplayerGameSessions, type GameActionResult, type MultiplayerGameSessionsOptions, type MultiplayerGameState } from "./game-sessions.js";
import { RoomManager, type PublicRoomState, type RoomClosedNotice, type RoomCredential, type RoomResult, type RoomStartNotice } from "./room-manager.js";

export type RoomAck<T> = RoomResult<T>;
export type GameAck<T> = GameActionResult<T>;

export interface ClientToServerEvents {
  "room:create": (ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:join": (payload: { readonly roomCode: string }, ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:resume": (payload: { readonly sessionToken: string }, ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:leave": (ack: (response: RoomAck<{ readonly left: true }>) => void) => void;
  "room:start": (ack: (response: RoomAck<RoomStartNotice & { readonly room: PublicRoomState }>) => void) => void;
  "game:get-state": (ack: (response: GameAck<MultiplayerGameState>) => void) => void;
  "game:bid": (payload: { readonly matchId: string; readonly suit: Suit | null }, ack: (response: GameAck<{ readonly accepted: true }>) => void) => void;
  "game:play-card": (payload: { readonly matchId: string; readonly cardId: string; readonly callBela: boolean }, ack: (response: GameAck<{ readonly accepted: true }>) => void) => void;
  "game:next-round": (payload: { readonly matchId: string; readonly roundNumber: number }, ack: (response: GameAck<{ readonly accepted: true; readonly waitingForOpponent: boolean }>) => void) => void;
  "game:new-match": (payload: { readonly matchId: string }, ack: (response: GameAck<{ readonly accepted: true; readonly waitingForOpponent: boolean }>) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: PublicRoomState | RoomClosedNotice) => void;
  "room:started": (notice: RoomStartNotice) => void;
  "game:state": (state: MultiplayerGameState) => void;
}

export interface InterServerEvents {}
export interface SocketData {}

type MultiplayerServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type MultiplayerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const socketRoom = (code: string) => `private-room:${code}`;
const fail = <T>(code: string, message: string): GameAck<T> => ({ ok: false, error: { code, message } });

function hasAck<T>(value: unknown): value is (response: T) => void {
  return typeof value === "function";
}

function emitState(io: MultiplayerServer, code: string, state: PublicRoomState | RoomClosedNotice): void {
  io.to(socketRoom(code)).emit("room:state", state);
}

function sendCredential(io: MultiplayerServer, socket: MultiplayerSocket, ack: (response: RoomAck<RoomCredential>) => void, result: RoomResult<RoomCredential>): void {
  if (!result.ok) {
    ack(result);
    return;
  }
  socket.join(socketRoom(result.data.room.code));
  ack(result);
  emitState(io, result.data.room.code, result.data.room);
}

export function attachMultiplayerHandlers(io: MultiplayerServer, manager = new RoomManager(), gameOptions: Omit<MultiplayerGameSessionsOptions, "onStateChanged"> = {}): RoomManager {
  const games = new MultiplayerGameSessions(manager, {
    ...gameOptions,
    onStateChanged: (code) => emitGameStates(io, manager, games, code),
  });

  io.on("connection", (socket) => {
    socket.on("room:create", (ack) => {
      if (!hasAck<RoomAck<RoomCredential>>(ack)) return;
      sendCredential(io, socket, ack, manager.create(socket.id));
    });

    socket.on("room:join", (payload, ack) => {
      if (!hasAck<RoomAck<RoomCredential>>(ack)) return;
      sendCredential(io, socket, ack, manager.join(socket.id, payload?.roomCode));
    });

    socket.on("room:resume", (payload, ack) => {
      if (!hasAck<RoomAck<RoomCredential>>(ack)) return;
      const resumed = manager.resume(socket.id, payload?.sessionToken);
      if (!resumed.ok) {
        ack(resumed);
        return;
      }
      if (resumed.data.previousSocketId) io.sockets.sockets.get(resumed.data.previousSocketId)?.leave(socketRoom(resumed.data.room.code));
      socket.join(socketRoom(resumed.data.room.code));
      const { previousSocketId: _previousSocketId, ...credential } = resumed.data;
      ack({ ok: true, data: credential });
      emitState(io, credential.room.code, credential.room);
      emitGameStates(io, manager, games, credential.room.code);
    });

    socket.on("room:leave", (ack) => {
      if (!hasAck<RoomAck<{ readonly left: true }>>(ack)) return;
      const result = manager.leave(socket.id);
      if (!result.ok) {
        ack(result);
        return;
      }
      const { roomCode, player, closed, disconnectedSocketIds, room } = result.data;
      if (closed) {
        games.closeRoom(roomCode);
        emitState(io, roomCode, { roomCode, closed: true, reason: "creator-left" });
        for (const socketId of disconnectedSocketIds) io.sockets.sockets.get(socketId)?.leave(socketRoom(roomCode));
      } else {
        games.playerLeft(roomCode, player);
        socket.leave(socketRoom(roomCode));
        if (room) emitState(io, roomCode, room);
        emitGameStates(io, manager, games, roomCode);
      }
      ack({ ok: true, data: { left: true } });
    });

    socket.on("room:start", (ack) => {
      if (!hasAck<RoomAck<RoomStartNotice & { readonly room: PublicRoomState }>>(ack)) return;
      const result = manager.start(socket.id);
      if (!result.ok) {
        ack(result);
        return;
      }
      const started = games.start(result.data.roomCode);
      if (!started.ok) {
        ack({ ok: false, error: { code: "GAME_START_FAILED", message: started.error.message } });
        return;
      }
      emitState(io, result.data.roomCode, result.data.room);
      io.to(socketRoom(result.data.roomCode)).emit("room:started", { roomCode: result.data.roomCode, startedAt: result.data.startedAt });
      ack(result);
    });

    socket.on("game:get-state", (ack) => {
      if (!hasAck<GameAck<MultiplayerGameState>>(ack)) return;
      const identity = manager.getSocketIdentity(socket.id);
      if (!identity) return ack(fail("NOT_IN_ROOM", "PridruÅ¾ite se sobi prije pregleda partije."));
      const state = games.getPlayerState(identity.roomCode, identity.player);
      if (!state) return ack(fail("GAME_NOT_STARTED", "Partija u ovoj sobi nije zapoÄela."));
      ack({ ok: true, data: state });
    });

    socket.on("game:bid", (payload, ack) => {
      if (!hasAck<GameAck<{ readonly accepted: true }>>(ack)) return;
      const identity = requireIdentity(manager, socket, ack);
      if (!identity) return;
      const matchError = validateMatchId(games, identity.roomCode, payload?.matchId);
      if (matchError) return ack(matchError);
      if (payload?.suit !== null && !SUITS.includes(payload?.suit as Suit)) return ack(fail("INVALID_GAME_ACTION", "Odabrana boja nije valjana."));
      ack(games.submitBid(identity.roomCode, identity.player as Player, payload.suit));
    });

    socket.on("game:play-card", (payload, ack) => {
      if (!hasAck<GameAck<{ readonly accepted: true }>>(ack)) return;
      const identity = requireIdentity(manager, socket, ack);
      if (!identity) return;
      const matchError = validateMatchId(games, identity.roomCode, payload?.matchId);
      if (matchError) return ack(matchError);
      if (typeof payload?.cardId !== "string" || typeof payload?.callBela !== "boolean") return ack(fail("INVALID_GAME_ACTION", "Odigrana karta nije valjana."));
      ack(games.play(identity.roomCode, identity.player as Player, payload.cardId, payload.callBela));
    });

    socket.on("game:next-round", (payload, ack) => {
      if (!hasAck<GameAck<{ readonly accepted: true; readonly waitingForOpponent: boolean }>>(ack)) return;
      const identity = requireIdentity(manager, socket, ack);
      if (!identity) return;
      const matchError = validateMatchId(games, identity.roomCode, payload?.matchId);
      if (matchError) return ack(matchError);
      if (!Number.isSafeInteger(payload?.roundNumber)) return ack(fail("INVALID_GAME_ACTION", "Broj runde nije valjan."));
      ack(games.confirmNextRound(identity.roomCode, identity.player as Player, payload.roundNumber));
    });

    socket.on("game:new-match", (payload, ack) => {
      if (!hasAck<GameAck<{ readonly accepted: true; readonly waitingForOpponent: boolean }>>(ack)) return;
      const identity = requireIdentity(manager, socket, ack);
      if (!identity) return;
      const matchError = validateMatchId(games, identity.roomCode, payload?.matchId);
      if (matchError) return ack(matchError);
      ack(games.confirmNewMatch(identity.roomCode, identity.player as Player));
    });

    socket.on("disconnect", () => {
      const disconnected = manager.disconnect(socket.id);
      if (disconnected) {
        emitState(io, disconnected.roomCode, disconnected.room);
        emitGameStates(io, manager, games, disconnected.roomCode);
      }
    });
  });
  return manager;
}

function requireIdentity<T>(manager: RoomManager, socket: MultiplayerSocket, ack: (response: GameAck<T>) => void) {
  const identity = manager.getSocketIdentity(socket.id);
  if (!identity) ack(fail("NOT_IN_ROOM", "PridruÅ¾ite se sobi prije radnje u partiji."));
  return identity;
}

function validateMatchId(games: MultiplayerGameSessions, roomCode: string, supplied: unknown): GameAck<never> | null {
  const current = games.getPlayerState(roomCode, "player1");
  if (!current) return fail("GAME_NOT_STARTED", "Partija u ovoj sobi nije zapoÄela.");
  if (typeof supplied !== "string" || supplied !== current.matchId) return fail("STALE_MATCH", "Ova radnja pripada staroj partiji. OsvjeÅ¾ite prikaz.");
  return null;
}

function emitGameStateToPlayer(io: MultiplayerServer, manager: RoomManager, games: MultiplayerGameSessions, roomCode: string, player: "player1" | "player2"): void {
  const socketId = manager.getPlayerSocketId(roomCode, player);
  const state = games.getPlayerState(roomCode, player);
  if (socketId && state) io.to(socketId).emit("game:state", state);
}

function emitGameStates(io: MultiplayerServer, manager: RoomManager, games: MultiplayerGameSessions, roomCode: string): void {
  emitGameStateToPlayer(io, manager, games, roomCode, "player1");
  emitGameStateToPlayer(io, manager, games, roomCode, "player2");
}
