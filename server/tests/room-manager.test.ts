import { describe, expect, it } from "vitest";
import { RoomManager } from "../src/multiplayer/room-manager.js";

const token = (letter: string) => `${letter.repeat(42)}_`;

function makeManager(codes = ["K7M4XP", "R8T6WY", "B2C3D4"]) {
  let codeIndex = 0;
  let tokenIndex = 0;
  const tokens = ["A", "B", "C", "D", "E", "F"].map(token);
  return new RoomManager({
    generateRoomCode: () => codes[Math.min(codeIndex++, codes.length - 1)],
    generateSessionToken: () => tokens[tokenIndex++ % tokens.length],
    now: () => new Date("2026-11-18T10:00:00.000Z"),
  });
}

describe("private multiplayer room manager", () => {
  it("creates a unique private room and assigns the creator to Player 1", () => {
    const manager = makeManager();
    const created = manager.create("socket-1");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.data.player).toBe("player1");
    expect(created.data.room).toMatchObject({ code: "K7M4XP", status: "waiting", creator: "player1" });
    expect(created.data.room.players).toEqual({
      player1: { assigned: true, connected: true },
      player2: { assigned: false, connected: false },
    });
    expect(created.data.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(created.data.room)).not.toContain(created.data.sessionToken);
  });

  it("retries room-code collisions and returns a different code", () => {
    const manager = makeManager(["K7M4XP", "K7M4XP", "R8T6WY"]);
    const first = manager.create("socket-1");
    const second = manager.create("socket-2");
    expect(first.ok && first.data.room.code).toBe("K7M4XP");
    expect(second.ok && second.data.room.code).toBe("R8T6WY");
  });

  it("normalizes valid room codes and assigns a joiner to Player 2", () => {
    const manager = makeManager();
    const creator = manager.create("socket-1");
    expect(creator.ok).toBe(true);
    const joined = manager.join("socket-2", " k7m4xp ");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.data.player).toBe("player2");
    expect(joined.data.room.status).toBe("ready");
    expect(joined.data.room.players.player2).toEqual({ assigned: true, connected: true });
  });

  it("rejects malformed and nonexistent room codes with distinct errors", () => {
    const manager = makeManager();
    expect(manager.join("socket-1", "bad!")).toMatchObject({ ok: false, error: { code: "INVALID_ROOM_CODE" } });
    expect(manager.join("socket-1", "ZZZZZZ")).toMatchObject({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });

  it("rejects a third player while the Player 2 seat is assigned", () => {
    const manager = makeManager();
    manager.create("socket-1");
    manager.join("socket-2", "K7M4XP");
    expect(manager.join("socket-3", "K7M4XP")).toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });
  });

  it("allows only the connected creator to start after both seats connect", () => {
    const manager = makeManager();
    manager.create("socket-1");
    expect(manager.start("socket-1")).toMatchObject({ ok: false, error: { code: "SECOND_PLAYER_NOT_CONNECTED" } });
    manager.join("socket-2", "K7M4XP");
    expect(manager.start("socket-2")).toMatchObject({ ok: false, error: { code: "NOT_CREATOR" } });
    expect(manager.start("socket-1")).toMatchObject({ ok: true, data: { room: { status: "started" } } });
    expect(manager.start("socket-1")).toMatchObject({ ok: false, error: { code: "ROOM_STARTED" } });
  });

  it("retains a disconnected seat and restores it with the valid token", () => {
    const manager = makeManager();
    manager.create("socket-1");
    const joined = manager.join("socket-2", "K7M4XP");
    if (!joined.ok) throw new Error("join failed");
    const disconnected = manager.disconnect("socket-2");
    expect(disconnected?.room).toMatchObject({ status: "waiting", players: { player2: { assigned: true, connected: false } } });
    expect(manager.join("socket-3", "K7M4XP")).toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });
    const resumed = manager.resume("socket-3", joined.data.sessionToken);
    expect(resumed).toMatchObject({ ok: true, data: { player: "player2", room: { status: "ready" } } });
  });

  it("rejects invalid or expired resume tokens", () => {
    const manager = makeManager();
    manager.create("socket-1");
    expect(manager.resume("socket-2", "not-a-valid-token")).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
    expect(manager.resume("socket-2", token("Z"))).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
  });

  it("prevents a Player 2 socket from impersonating the creator", () => {
    const manager = makeManager();
    const creator = manager.create("socket-1");
    manager.join("socket-2", "K7M4XP");
    expect(manager.start("socket-2")).toMatchObject({ ok: false, error: { code: "NOT_CREATOR" } });
    if (!creator.ok) throw new Error("create failed");
    expect(manager.resume("socket-2", creator.data.sessionToken)).toMatchObject({ ok: false, error: { code: "SOCKET_ALREADY_IN_ROOM" } });
  });

  it("allows Player 2 to leave and makes the seat available again", () => {
    const manager = makeManager();
    manager.create("socket-1");
    manager.join("socket-2", "K7M4XP");
    const left = manager.leave("socket-2");
    expect(left).toMatchObject({ ok: true, data: { closed: false, room: { status: "waiting", players: { player2: { assigned: false, connected: false } } } } });
    expect(manager.join("socket-3", "K7M4XP")).toMatchObject({ ok: true, data: { player: "player2" } });
  });

  it("makes the Player 2 seat available if they leave after the Stage 1 start", () => {
    const manager = makeManager();
    manager.create("socket-1");
    manager.join("socket-2", "K7M4XP");
    expect(manager.start("socket-1").ok).toBe(true);
    expect(manager.leave("socket-2")).toMatchObject({ ok: true, data: { closed: false } });
    expect(manager.join("socket-3", "K7M4XP")).toMatchObject({ ok: true, data: { player: "player2", room: { status: "started" } } });
  });

  it("closes the room and invalidates both seats when the creator leaves", () => {
    const manager = makeManager();
    const creator = manager.create("socket-1");
    const player2 = manager.join("socket-2", "K7M4XP");
    if (!creator.ok || !player2.ok) throw new Error("room setup failed");
    expect(manager.leave("socket-1")).toMatchObject({ ok: true, data: { closed: true, disconnectedSocketIds: ["socket-1", "socket-2"], room: null } });
    expect(manager.getRoom("K7M4XP")).toBeNull();
    expect(manager.resume("socket-3", player2.data.sessionToken)).toMatchObject({ ok: false, error: { code: "INVALID_SESSION" } });
  });

  it("lets only the latest resumed socket control a seat and ignores stale disconnects", () => {
    const manager = makeManager();
    const creator = manager.create("socket-1");
    if (!creator.ok) throw new Error("create failed");
    const resumed = manager.resume("socket-2", creator.data.sessionToken);
    expect(resumed).toMatchObject({ ok: true, data: { previousSocketId: "socket-1" } });
    expect(manager.disconnect("socket-1")).toBeNull();
    expect(manager.getRoom("K7M4XP")).toMatchObject({ players: { player1: { assigned: true, connected: true } } });
  });
});
