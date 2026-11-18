import { createHash, randomBytes, randomInt } from "node:crypto";

export type RoomPlayer = "player1" | "player2";
export type RoomStatus = "waiting" | "ready" | "started";

export interface PublicPlayerSlot {
  readonly assigned: boolean;
  readonly connected: boolean;
}

export interface PublicRoomState {
  readonly code: string;
  readonly createdAt: string;
  readonly creator: "player1";
  readonly status: RoomStatus;
  readonly players: Readonly<Record<RoomPlayer, PublicPlayerSlot>>;
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

export type RoomErrorCode =
  | "INVALID_ROOM_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_STARTED"
  | "SOCKET_ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "INVALID_SESSION"
  | "NOT_CREATOR"
  | "SECOND_PLAYER_NOT_CONNECTED"
  | "ROOM_CODE_GENERATION_FAILED"
  | "SESSION_GENERATION_FAILED"
  | "GAME_START_FAILED";

export interface RoomError {
  readonly code: RoomErrorCode;
  readonly message: string;
}

export type RoomResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: RoomError };

interface Seat {
  readonly sessionHash: string;
  socketId: string | null;
}

interface Room {
  readonly code: string;
  readonly createdAt: string;
  readonly creator: "player1";
  readonly players: { player1: Seat; player2: Seat | null };
  status: RoomStatus;
  startedAt: string | null;
}

interface SocketBinding {
  readonly roomCode: string;
  readonly player: RoomPlayer;
  readonly sessionHash: string;
}

interface RoomManagerOptions {
  readonly generateRoomCode?: () => string;
  readonly generateSessionToken?: () => string;
  readonly now?: () => Date;
  readonly maxCodeAttempts?: number;
  readonly maxSessionAttempts?: number;
}

export interface RoomLeaveResult {
  readonly roomCode: string;
  readonly player: RoomPlayer;
  readonly closed: boolean;
  readonly disconnectedSocketIds: readonly string[];
  readonly room: PublicRoomState | null;
}

export interface RoomDisconnectResult {
  readonly roomCode: string;
  readonly room: PublicRoomState;
}

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

function secureRoomCode(): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join("");
}

function secureSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function failure<T = never>(code: RoomErrorCode, message: string): RoomResult<T> {
  return { ok: false, error: { code, message } };
}

function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

/** In-memory private room/session registry. Public snapshots never include tokens or token hashes. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, { readonly roomCode: string; readonly player: RoomPlayer }>();
  private readonly socketBindings = new Map<string, SocketBinding>();
  private readonly generateRoomCode: () => string;
  private readonly generateSessionToken: () => string;
  private readonly now: () => Date;
  private readonly maxCodeAttempts: number;
  private readonly maxSessionAttempts: number;

  constructor(options: RoomManagerOptions = {}) {
    this.generateRoomCode = options.generateRoomCode ?? secureRoomCode;
    this.generateSessionToken = options.generateSessionToken ?? secureSessionToken;
    this.now = options.now ?? (() => new Date());
    this.maxCodeAttempts = options.maxCodeAttempts ?? 32;
    this.maxSessionAttempts = options.maxSessionAttempts ?? 8;
  }

  create(socketId: string): RoomResult<RoomCredential> {
    if (!socketId || this.socketBindings.has(socketId)) {
      return failure("SOCKET_ALREADY_IN_ROOM", "Ova veza već pripada sobi.");
    }

    let code: string | null = null;
    for (let attempt = 0; attempt < this.maxCodeAttempts; attempt += 1) {
      const candidate = normalizeRoomCode(this.generateRoomCode());
      if (candidate && !this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) return failure("ROOM_CODE_GENERATION_FAILED", "Nije moguće stvoriti jedinstvenu oznaku sobe. Pokušajte ponovno.");

    const session = this.createSession();
    if (!session) return failure("SESSION_GENERATION_FAILED", "Nije moguće stvoriti sigurnu sesiju. Pokušajte ponovno.");

    const room: Room = {
      code,
      createdAt: this.now().toISOString(),
      creator: "player1",
      players: { player1: { sessionHash: session.hash, socketId }, player2: null },
      status: "waiting",
      startedAt: null,
    };
    this.rooms.set(code, room);
    this.sessions.set(session.hash, { roomCode: code, player: "player1" });
    this.socketBindings.set(socketId, { roomCode: code, player: "player1", sessionHash: session.hash });
    return { ok: true, data: { room: this.publicRoom(room), player: "player1", sessionToken: session.token } };
  }

  join(socketId: string, suppliedCode: unknown): RoomResult<RoomCredential> {
    if (!socketId || this.socketBindings.has(socketId)) {
      return failure("SOCKET_ALREADY_IN_ROOM", "Ova veza već pripada sobi.");
    }
    const code = normalizeRoomCode(suppliedCode);
    if (!code) return failure("INVALID_ROOM_CODE", "Oznaka sobe mora sadržavati šest valjanih znakova.");
    const room = this.rooms.get(code);
    if (!room) return failure("ROOM_NOT_FOUND", "Soba s tom oznakom ne postoji.");
    if (room.players.player2) return failure("ROOM_FULL", "Soba već ima dva igrača.");

    const session = this.createSession();
    if (!session) return failure("SESSION_GENERATION_FAILED", "Nije moguće stvoriti sigurnu sesiju. Pokušajte ponovno.");
    room.players.player2 = { sessionHash: session.hash, socketId };
    this.sessions.set(session.hash, { roomCode: code, player: "player2" });
    this.socketBindings.set(socketId, { roomCode: code, player: "player2", sessionHash: session.hash });
    this.refreshStatus(room);
    return { ok: true, data: { room: this.publicRoom(room), player: "player2", sessionToken: session.token } };
  }

  resume(socketId: string, suppliedToken: unknown): RoomResult<RoomCredential & { readonly previousSocketId: string | null }> {
    if (!socketId) return failure("INVALID_SESSION", "Sesija nije valjana.");
    if (typeof suppliedToken !== "string" || !SESSION_TOKEN_PATTERN.test(suppliedToken)) {
      return failure("INVALID_SESSION", "Sesija nije valjana ili je istekla.");
    }
    const sessionHash = hashToken(suppliedToken);
    const session = this.sessions.get(sessionHash);
    if (!session) return failure("INVALID_SESSION", "Sesija nije valjana ili je istekla.");
    const existingBinding = this.socketBindings.get(socketId);
    if (existingBinding && (existingBinding.sessionHash !== sessionHash || existingBinding.roomCode !== session.roomCode)) {
      return failure("SOCKET_ALREADY_IN_ROOM", "Ova veza već pripada drugoj sobi.");
    }

    const room = this.rooms.get(session.roomCode);
    if (!room) return failure("INVALID_SESSION", "Sesija nije valjana ili je istekla.");
    const seat = room.players[session.player];
    if (!seat || seat.sessionHash !== sessionHash) return failure("INVALID_SESSION", "Sesija nije valjana ili je istekla.");
    if (seat.socketId === socketId) {
      return { ok: true, data: { room: this.publicRoom(room), player: session.player, sessionToken: suppliedToken, previousSocketId: null } };
    }

    const previousSocketId = seat.socketId;
    if (previousSocketId) this.socketBindings.delete(previousSocketId);
    seat.socketId = socketId;
    this.socketBindings.set(socketId, { roomCode: room.code, player: session.player, sessionHash });
    this.refreshStatus(room);
    return { ok: true, data: { room: this.publicRoom(room), player: session.player, sessionToken: suppliedToken, previousSocketId } };
  }

  start(socketId: string): RoomResult<RoomStartNotice & { readonly room: PublicRoomState }> {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return failure("NOT_IN_ROOM", "Pridružite se sobi prije početka partije.");
    const room = this.rooms.get(binding.roomCode);
    if (!room) return failure("NOT_IN_ROOM", "Soba više ne postoji.");
    if (binding.player !== room.creator) return failure("NOT_CREATOR", "Samo kreator sobe može započeti partiju.");
    if (!room.players.player2?.socketId) return failure("SECOND_PLAYER_NOT_CONNECTED", "Drugi igrač još nije povezan.");
    if (room.status === "started") return failure("ROOM_STARTED", "Partija je već započela.");

    room.status = "started";
    room.startedAt = this.now().toISOString();
    return { ok: true, data: { room: this.publicRoom(room), roomCode: room.code, startedAt: room.startedAt } };
  }

  leave(socketId: string): RoomResult<RoomLeaveResult> {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return failure("NOT_IN_ROOM", "Trenutačno niste u sobi.");
    const room = this.rooms.get(binding.roomCode);
    this.socketBindings.delete(socketId);
    if (!room) return { ok: true, data: { roomCode: binding.roomCode, player: binding.player, closed: true, disconnectedSocketIds: [], room: null } };

    if (binding.player === room.creator) {
      const disconnectedSocketIds = [room.players.player1.socketId, room.players.player2?.socketId]
        .filter((value): value is string => Boolean(value));
      this.removeRoom(room);
      return { ok: true, data: { roomCode: room.code, player: binding.player, closed: true, disconnectedSocketIds, room: null } };
    }

    const seat = room.players.player2;
    if (seat?.sessionHash === binding.sessionHash) {
      if (seat.socketId && seat.socketId !== socketId) this.socketBindings.delete(seat.socketId);
      this.sessions.delete(seat.sessionHash);
      room.players.player2 = null;
    }
    this.refreshStatus(room);
    return { ok: true, data: { roomCode: room.code, player: binding.player, closed: false, disconnectedSocketIds: [], room: this.publicRoom(room) } };
  }

  disconnect(socketId: string): RoomDisconnectResult | null {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return null;
    this.socketBindings.delete(socketId);
    const room = this.rooms.get(binding.roomCode);
    if (!room) return null;
    const seat = room.players[binding.player];
    if (!seat || seat.sessionHash !== binding.sessionHash || seat.socketId !== socketId) return null;
    seat.socketId = null;
    this.refreshStatus(room);
    return { roomCode: room.code, room: this.publicRoom(room) };
  }

  getRoom(code: unknown): PublicRoomState | null {
    const normalized = normalizeRoomCode(code);
    const room = normalized ? this.rooms.get(normalized) : undefined;
    return room ? this.publicRoom(room) : null;
  }

  /** Server-only identity derived from the currently controlling socket, never client input. */
  getSocketIdentity(socketId: string): { readonly roomCode: string; readonly player: RoomPlayer } | null {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return null;
    const room = this.rooms.get(binding.roomCode);
    const seat = room?.players[binding.player];
    if (!room || !seat || seat.socketId !== socketId || seat.sessionHash !== binding.sessionHash) return null;
    return { roomCode: binding.roomCode, player: binding.player };
  }

  /** Current socket for a seat; a resumed session replaces the previous socket. */
  getPlayerSocketId(roomCode: string, player: RoomPlayer): string | null {
    const room = this.rooms.get(roomCode);
    return room?.players[player]?.socketId ?? null;
  }

  private createSession(): { readonly token: string; readonly hash: string } | null {
    for (let attempt = 0; attempt < this.maxSessionAttempts; attempt += 1) {
      const token = this.generateSessionToken();
      if (!SESSION_TOKEN_PATTERN.test(token)) continue;
      const hash = hashToken(token);
      if (!this.sessions.has(hash)) return { token, hash };
    }
    return null;
  }

  private refreshStatus(room: Room): void {
    if (room.status === "started") return;
    room.status = room.players.player1.socketId && room.players.player2?.socketId ? "ready" : "waiting";
  }

  private publicRoom(room: Room): PublicRoomState {
    return {
      code: room.code,
      createdAt: room.createdAt,
      creator: room.creator,
      status: room.status,
      players: {
        player1: { assigned: true, connected: room.players.player1.socketId !== null },
        player2: { assigned: room.players.player2 !== null, connected: Boolean(room.players.player2?.socketId) },
      },
    };
  }

  private removeRoom(room: Room): void {
    this.rooms.delete(room.code);
    this.sessions.delete(room.players.player1.sessionHash);
    if (room.players.player2) this.sessions.delete(room.players.player2.sessionHash);
    if (room.players.player1.socketId) this.socketBindings.delete(room.players.player1.socketId);
    if (room.players.player2?.socketId) this.socketBindings.delete(room.players.player2.socketId);
  }
}
