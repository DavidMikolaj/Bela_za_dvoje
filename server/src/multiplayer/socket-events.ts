import type { Server, Socket } from "socket.io";
import { RoomManager, type PublicRoomState, type RoomClosedNotice, type RoomCredential, type RoomResult, type RoomStartNotice } from "./room-manager.js";

export type RoomAck<T> = RoomResult<T>;

export interface ClientToServerEvents {
  "room:create": (ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:join": (payload: { readonly roomCode: string }, ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:resume": (payload: { readonly sessionToken: string }, ack: (response: RoomAck<RoomCredential>) => void) => void;
  "room:leave": (ack: (response: RoomAck<{ readonly left: true }>) => void) => void;
  "room:start": (ack: (response: RoomAck<RoomStartNotice & { readonly room: PublicRoomState }>) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: PublicRoomState | RoomClosedNotice) => void;
  "room:started": (notice: RoomStartNotice) => void;
}

export interface InterServerEvents {}
export interface SocketData {}

type MultiplayerServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type MultiplayerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const socketRoom = (code: string) => `private-room:${code}`;

function hasAck<T>(value: unknown): value is (response: RoomAck<T>) => void {
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

export function attachMultiplayerHandlers(io: MultiplayerServer, manager = new RoomManager()): RoomManager {
  io.on("connection", (socket) => {
    socket.on("room:create", (ack) => {
      if (!hasAck<RoomCredential>(ack)) return;
      sendCredential(io, socket, ack, manager.create(socket.id));
    });

    socket.on("room:join", (payload, ack) => {
      if (!hasAck<RoomCredential>(ack)) return;
      const roomCode = payload?.roomCode;
      sendCredential(io, socket, ack, manager.join(socket.id, roomCode));
    });

    socket.on("room:resume", (payload, ack) => {
      if (!hasAck<RoomCredential>(ack)) return;
      const sessionToken = payload?.sessionToken;
      const resumed = manager.resume(socket.id, sessionToken);
      if (!resumed.ok) {
        ack(resumed);
        return;
      }
      if (resumed.data.previousSocketId) {
        io.sockets.sockets.get(resumed.data.previousSocketId)?.leave(socketRoom(resumed.data.room.code));
      }
      socket.join(socketRoom(resumed.data.room.code));
      const { previousSocketId: _previousSocketId, ...credential } = resumed.data;
      ack({ ok: true, data: credential });
      emitState(io, credential.room.code, credential.room);
    });

    socket.on("room:leave", (ack) => {
      if (!hasAck<{ readonly left: true }>(ack)) return;
      const result = manager.leave(socket.id);
      if (!result.ok) {
        ack(result);
        return;
      }
      const { roomCode, closed, disconnectedSocketIds, room } = result.data;
      if (closed) {
        const notice: RoomClosedNotice = { roomCode, closed: true, reason: "creator-left" };
        emitState(io, roomCode, notice);
        for (const socketId of disconnectedSocketIds) {
          io.sockets.sockets.get(socketId)?.leave(socketRoom(roomCode));
        }
      } else {
        socket.leave(socketRoom(roomCode));
        if (room) emitState(io, roomCode, room);
      }
      ack({ ok: true, data: { left: true } });
    });

    socket.on("room:start", (ack) => {
      if (!hasAck<RoomStartNotice & { readonly room: PublicRoomState }>(ack)) return;
      const result = manager.start(socket.id);
      if (!result.ok) {
        ack(result);
        return;
      }
      emitState(io, result.data.roomCode, result.data.room);
      io.to(socketRoom(result.data.roomCode)).emit("room:started", {
        roomCode: result.data.roomCode,
        startedAt: result.data.startedAt,
      });
      ack(result);
    });

    socket.on("disconnect", () => {
      const disconnected = manager.disconnect(socket.id);
      if (disconnected) emitState(io, disconnected.roomCode, disconnected.room);
    });
  });
  return manager;
}
