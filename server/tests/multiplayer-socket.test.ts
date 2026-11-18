import { describe, expect, it } from "vitest";
import { attachMultiplayerHandlers, type ClientToServerEvents, type InterServerEvents, type ServerToClientEvents, type SocketData } from "../src/multiplayer/socket-events.js";
import { RoomManager } from "../src/multiplayer/room-manager.js";

type AnyHandler = (...args: any[]) => void;

class FakeSocket {
  readonly rooms = new Set<string>();
  readonly received: Array<{ event: string; payload: any }> = [];
  private readonly handlers = new Map<string, AnyHandler>();

  constructor(readonly id: string, private readonly server: FakeIo) {}
  on(event: string, handler: AnyHandler) { this.handlers.set(event, handler); return this; }
  join(room: string) { this.rooms.add(room); }
  leave(room: string) { this.rooms.delete(room); }
  emit(event: string, payload: any) { this.received.push({ event, payload }); }
  trigger(event: string, ...args: any[]) { this.handlers.get(event)?.(...args); }
  request<T>(event: string, ...args: any[]): Promise<T> {
    return new Promise((resolve) => this.trigger(event, ...args, resolve));
  }
  events(event: string) { return this.received.filter((entry) => entry.event === event).map((entry) => entry.payload); }
  close() { this.trigger("disconnect"); this.server.sockets.sockets.delete(this.id); }
}

class FakeIo {
  private connectHandler: ((socket: FakeSocket) => void) | null = null;
  readonly sockets = { sockets: new Map<string, FakeSocket>() };

  on(event: string, handler: (socket: FakeSocket) => void) { if (event === "connection") this.connectHandler = handler; return this; }
  connect(id: string) {
    const socket = new FakeSocket(id, this);
    this.sockets.sockets.set(id, socket);
    this.connectHandler?.(socket);
    return socket;
  }
  to(room: string) {
    return { emit: (event: string, payload: any) => {
      for (const socket of this.sockets.sockets.values()) if (socket.rooms.has(room)) socket.emit(event, payload);
    } };
  }
  in(room: string) {
    return { socketsLeave: (target: string) => {
      for (const socket of this.sockets.sockets.values()) if (socket.rooms.has(room)) socket.leave(target);
    } };
  }
}

function setup() {
  const io = new FakeIo();
  let nextCode = 0;
  let nextToken = 0;
  const manager = new RoomManager({
    generateRoomCode: () => ["K7M4XP", "R8T6WY"][Math.min(nextCode++, 1)],
    generateSessionToken: () => `${String.fromCharCode(65 + nextToken++).repeat(42)}_`,
  });
  attachMultiplayerHandlers(io as unknown as import("socket.io").Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, manager);
  return { io, manager };
}

describe("multiplayer Socket.IO events", () => {
  it("requires acknowledgement callbacks before mutating room state", async () => {
    const { io, manager } = setup();
    const client = io.connect("client");
    client.trigger("room:create");
    expect(manager.getRoom("K7M4XP")).toBeNull();
    expect(await client.request<any>("room:create")).toMatchObject({ ok: true, data: { room: { code: "K7M4XP" } } });
  });

  it("updates both lobby clients and keeps session tokens out of public events", async () => {
    const { io } = setup();
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    const created = await creator.request<any>("room:create");
    const joined = await joiner.request<any>("room:join", { roomCode: created.data.room.code.toLowerCase() });

    expect(created).toMatchObject({ ok: true, data: { player: "player1" } });
    expect(joined).toMatchObject({ ok: true, data: { player: "player2", room: { status: "ready" } } });
    expect(creator.events("room:state").at(-1)).toMatchObject({ status: "ready", players: { player1: { connected: true }, player2: { connected: true } } });
    expect(joiner.events("room:state").at(-1)).toMatchObject({ status: "ready" });

    const publicEvents = [...creator.events("room:state"), ...joiner.events("room:state")];
    expect(JSON.stringify(publicEvents)).not.toContain(created.data.sessionToken);
    expect(JSON.stringify(publicEvents)).not.toContain(joined.data.sessionToken);
    expect(JSON.stringify(publicEvents)).not.toContain("sessionHash");

    expect(await joiner.request<any>("room:start")).toMatchObject({ ok: false, error: { code: "NOT_CREATOR" } });
    expect(await creator.request<any>("room:start")).toMatchObject({ ok: true, data: { room: { status: "started" } } });
    expect(creator.events("room:started")).toHaveLength(1);
    expect(joiner.events("room:started")).toHaveLength(1);
  });

  it("broadcasts disconnects and creator closure only to that room", async () => {
    const { io } = setup();
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    const outsider = io.connect("outsider");
    await creator.request("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    joiner.close();
    expect(creator.events("room:state").at(-1)).toMatchObject({ status: "waiting", players: { player2: { assigned: true, connected: false } } });
    expect(outsider.events("room:state")).toHaveLength(0);
    const closed = await creator.request<any>("room:leave");
    expect(closed).toMatchObject({ ok: true, data: { left: true } });
    expect(creator.events("room:state").at(-1)).toMatchObject({ closed: true, reason: "creator-left" });
    expect(outsider.events("room:state")).toHaveLength(0);
  });
});
