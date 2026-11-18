import { afterEach, describe, expect, it, vi } from "vitest";
import { attachMultiplayerHandlers, type ClientToServerEvents, type InterServerEvents, type ServerToClientEvents, type SocketData } from "../src/multiplayer/socket-events.js";
import { RoomManager } from "../src/multiplayer/room-manager.js";
import { createDeck } from "../src/game/cards.js";
import { dealGame } from "../src/game/game-engine.js";
import type { GameState, Player } from "../src/game/types.js";

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
    if (["game:bid", "game:play-card", "game:next-round", "game:new-match"].includes(event)) {
      const payload = args[0] ?? {};
      const latest = this.events("game:state").at(-1);
      if (typeof payload.matchId !== "string" && latest?.matchId) args[0] = { ...payload, matchId: latest.matchId };
    }
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
      for (const socket of this.sockets.sockets.values()) if (socket.rooms.has(room) || socket.id === room) socket.emit(event, payload);
    } };
  }
  in(room: string) {
    return { socketsLeave: (target: string) => {
      for (const socket of this.sockets.sockets.values()) if (socket.rooms.has(room)) socket.leave(target);
    } };
  }
}

function setup(trickDisplayMs = 1500, createGameState?: () => GameState) {
  const io = new FakeIo();
  let nextCode = 0;
  let nextToken = 0;
  const manager = new RoomManager({
    generateRoomCode: () => ["K7M4XP", "R8T6WY"][Math.min(nextCode++, 1)],
    generateSessionToken: () => `${String.fromCharCode(65 + nextToken++).repeat(42)}_`,
  });
  attachMultiplayerHandlers(io as unknown as import("socket.io").Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, manager, { trickDisplayMs, createGameState });
  return { io, manager };
}

describe("multiplayer Socket.IO events", () => {
  afterEach(() => vi.useRealTimers());
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
    expect(await creator.request<any>("room:start")).toMatchObject({ ok: false, error: { code: "ROOM_STARTED" } });
    expect(creator.events("game:state")).toHaveLength(1);
    expect(joiner.events("game:state")).toHaveLength(1);
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

  it("sends private game views and routes bids and card plays by authenticated seat", async () => {
    const { io } = setup();
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    const created = await creator.request<any>("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");

    const p1State = creator.events("game:state").at(-1);
    const p2State = joiner.events("game:state").at(-1);
    expect(p1State.view.viewer).toBe("player1");
    expect(p2State.view.viewer).toBe("player2");
    expect(p1State.view.hands.player2.cards).toEqual([]);
    expect(p2State.view.hands.player1.cards).toEqual([]);
    expect(p1State.view.hands.player1.cards).toHaveLength(6);
    expect(p2State.view.hands.player2.cards).toHaveLength(6);
    expect(p1State.view.faceDownStackCount).toBe(11);

    expect(await creator.request<any>("game:bid", { suit: p1State.view.faceUpCard.suit })).toMatchObject({ ok: false });
    expect(await joiner.request<any>("game:bid", { suit: "not-a-suit" })).toMatchObject({ ok: false, error: { code: "INVALID_GAME_ACTION" } });
    expect(await joiner.request<any>("game:bid", { suit: p2State.view.faceUpCard.suit })).toMatchObject({ ok: true });
    const p2Playing = joiner.events("game:state").at(-1);
    expect(p2Playing.view.phase).toBe("playing");
    expect(p2Playing.view.hands.player2.cards).toHaveLength(10);
    expect(p2Playing.view.hands.player1.cards).toEqual([]);

    const playable = p2Playing.view.legalCardIds[0];
    expect(playable).toBeTruthy();
    const opponentCardId = creator.events("game:state").at(-1).view.hands.player1.cards[0].id;
    expect(await joiner.request<any>("game:play-card", { cardId: opponentCardId, callBela: false })).toMatchObject({ ok: false });
    expect(await creator.request<any>("game:play-card", { cardId: playable, callBela: false })).toMatchObject({ ok: false });
    expect(await joiner.request<any>("game:play-card", { cardId: playable, callBela: false })).toMatchObject({ ok: true });
    const p1AfterPlay = creator.events("game:state").at(-1);
    const p2AfterPlay = joiner.events("game:state").at(-1);
    expect(p1AfterPlay.view.hands.player1.cards).toHaveLength(10);
    expect(p1AfterPlay.view.hands.player2.cards).toEqual([]);
    expect(p2AfterPlay.view.hands.player2.cards).toHaveLength(9);
    expect(p2AfterPlay.view.hands.player1.cards).toEqual([]);
    expect(created.data.sessionToken).toBeTruthy();
  });

  it("restores the same filtered hand after a player reconnects", async () => {
    const { io } = setup();
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    const created = await creator.request<any>("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");
    const faceUpSuit = creator.events("game:state").at(-1).view.faceUpCard.suit;
    await joiner.request("game:bid", { suit: faceUpSuit });
    const expectedIds = creator.events("game:state").at(-1).view.hands.player1.cards.map((card: { id: string }) => card.id);
    const playerTwoView = joiner.events("game:state").at(-1).view;
    await joiner.request("game:play-card", { cardId: playerTwoView.legalCardIds[0], callBela: false });

    const replacement = io.connect("replacement");
    expect(await replacement.request<any>("room:resume", { sessionToken: created.data.sessionToken })).toMatchObject({ ok: true });
    const resumed = replacement.events("game:state").at(-1);
    expect(resumed.view.viewer).toBe("player1");
    expect(resumed.view.phase).toBe("playing");
    expect(resumed.view.currentPlayer).toBe("player1");
    expect(resumed.view.hands.player1.cards.map((card: { id: string }) => card.id)).toEqual(expectedIds);
    expect(resumed.view.hands.player2.cards).toEqual([]);
    expect(await creator.request<any>("game:bid", { suit: faceUpSuit })).toMatchObject({ ok: false, error: { code: "NOT_IN_ROOM" } });
  });

  it("preserves a pending trick timer across reconnect without replaying the transition", async () => {
    vi.useFakeTimers();
    const { io } = setup(100);
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    const created = await creator.request<any>("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");
    const nonDealer = joiner.events("game:state").at(-1).view;
    await joiner.request("game:bid", { suit: nonDealer.faceUpCard.suit });
    const leadView = joiner.events("game:state").at(-1).view;
    await joiner.request("game:play-card", { cardId: leadView.legalCardIds[0], callBela: false });
    const responseView = creator.events("game:state").at(-1).view;
    await creator.request("game:play-card", { cardId: responseView.legalCardIds[0], callBela: false });
    expect(joiner.events("game:state").at(-1).view).toMatchObject({ phase: "trick-complete", awaitingTrickAcknowledgement: true });

    const replacement = io.connect("replacement");
    await replacement.request("room:resume", { sessionToken: created.data.sessionToken });
    expect(replacement.events("game:state").at(-1).view.currentTrick.cards).toHaveLength(2);
    expect(await creator.request<any>("game:play-card", { cardId: "stale-action", callBela: false })).toMatchObject({ ok: false, error: { code: "NOT_IN_ROOM" } });

    await vi.advanceTimersByTimeAsync(99);
    expect(replacement.events("game:state").at(-1).view.phase).toBe("trick-complete");
    await vi.advanceTimersByTimeAsync(1);
    const afterTransition = replacement.events("game:state").at(-1).view;
    expect(afterTransition.phase).toBe("playing");
    expect(afterTransition.tricksPlayed).toBe(1);
    expect(afterTransition.currentTrick.number).toBe(2);
    expect(afterTransition.currentTrick.cards).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(replacement.events("game:state").at(-1).view.tricksPlayed).toBe(1);
    expect(replacement.events("game:state").at(-1).view.currentTrick.number).toBe(2);
  });

  it("finishes ten server-timed tricks and starts the next round after both confirmations", async () => {
    vi.useFakeTimers();
    const { io } = setup(1);
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    await creator.request("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");

    const initial = joiner.events("game:state").at(-1).view;
    expect(await joiner.request<any>("game:bid", { suit: initial.faceUpCard.suit })).toMatchObject({ ok: true });

    for (let trick = 0; trick < 10; trick += 1) {
      for (let cardIndex = 0; cardIndex < 2; cardIndex += 1) {
        const playerView = [creator, joiner]
          .map((socket) => socket.events("game:state").at(-1).view)
          .find((view) => view.currentPlayer === view.viewer);
        expect(playerView).toBeDefined();
        expect(playerView.phase).toBe("playing");
        expect(playerView.legalCardIds.length).toBeGreaterThan(0);
        const socket = playerView.viewer === "player1" ? creator : joiner;
        expect(await socket.request<any>("game:play-card", { cardId: playerView.legalCardIds[0], callBela: false })).toMatchObject({ ok: true });
      }
      await vi.advanceTimersByTimeAsync(1);
    }

    const result = creator.events("game:state").at(-1).view;
    expect(result.phase).toBe("round-complete");
    expect(result.tricksPlayed).toBe(10);
    expect(result.hands.player1.cardCount).toBe(0);
    expect(result.hands.player2.cardCount).toBe(0);
    expect(await creator.request<any>("game:next-round", { roundNumber: 1 })).toMatchObject({ ok: true, data: { waitingForOpponent: true } });
    expect(await joiner.request<any>("game:next-round", { roundNumber: 1 })).toMatchObject({ ok: true, data: { waitingForOpponent: false } });

    const roundTwo = creator.events("game:state").at(-1).view;
    expect(roundTwo.roundNumber).toBe(2);
    expect(roundTwo.dealer).toBe("player2");
    expect(roundTwo.nonDealer).toBe("player1");
    expect(roundTwo.currentBidder).toBe("player1");
    expect(await creator.request<any>("game:next-round", { roundNumber: 1 })).toMatchObject({ ok: false });
  });

  it("requires both players to confirm a fresh match and rejects actions from the previous match", async () => {
    let deals = 0;
    const { io, manager } = setup(1500, () => {
      deals += 1;
      if (deals === 1) return { ...dealGame(createDeck(), 1, [], { player1: 1005, player2: 900 }, "player1"), phase: "round-complete", awaitingTrickAcknowledgement: false };
      return dealGame(createDeck());
    });
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    const created = await creator.request<any>("room:create");
    const joined = await joiner.request<any>("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");
    const oldState = creator.events("game:state").at(-1);
    const roomBefore = manager.getRoom("K7M4XP");
    expect(oldState.view.matchWinner).toBe("player1");

    expect(await creator.request<any>("game:new-match")).toMatchObject({ ok: true, data: { waitingForOpponent: true } });
    expect(creator.events("game:state").at(-1).newMatchReady.player1).toBe(true);
    expect(joiner.events("game:state").at(-1).newMatchReady.player1).toBe(true);
    expect(await creator.request<any>("game:new-match")).toMatchObject({ ok: true, data: { waitingForOpponent: true } });
    expect(creator.events("game:state").at(-1).matchId).toBe(oldState.matchId);
    joiner.close();
    expect(await creator.request<any>("game:new-match")).toMatchObject({ ok: false, error: { code: "OPPONENT_DISCONNECTED" } });

    const replacement = io.connect("replacement");
    expect(await replacement.request<any>("room:resume", { sessionToken: joined.data.sessionToken })).toMatchObject({ ok: true });
    expect(replacement.events("game:state").at(-1).newMatchReady.player1).toBe(true);
    expect(await replacement.request<any>("game:new-match")).toMatchObject({ ok: true, data: { waitingForOpponent: false } });

    const fresh = replacement.events("game:state").at(-1);
    expect(fresh.matchId).not.toBe(oldState.matchId);
    expect(fresh.view).toMatchObject({ roundNumber: 1, dealer: "player1", matchScores: { player1: 0, player2: 0 }, matchWinner: null, phase: "bidding" });
    expect(fresh.newMatchReady).toEqual({ player1: false, player2: false });
    expect(manager.getRoom("K7M4XP")).toMatchObject({ code: roomBefore?.code, players: { player1: { assigned: true }, player2: { assigned: true } } });
    expect(await replacement.request<any>("game:bid", { matchId: oldState.matchId, suit: fresh.view.faceUpCard.suit })).toMatchObject({ ok: false, error: { code: "STALE_MATCH" } });
    expect(await replacement.request<any>("game:new-match", { matchId: oldState.matchId })).toMatchObject({ ok: false, error: { code: "STALE_MATCH" } });
    expect(deals).toBe(2);
  });

  it("does not accept new-match votes until the final trick acknowledgement finishes", async () => {
    const state = { ...dealGame(createDeck(), 1, [], { player1: 1005, player2: 900 }, "player1"), phase: "round-complete" as const, awaitingTrickAcknowledgement: true };
    const { io } = setup(1500, () => state);
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    await creator.request("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");
    expect(await creator.request<any>("game:new-match")).toMatchObject({ ok: false, error: { code: "MATCH_NOT_COMPLETE" } });
    expect(creator.events("game:state").at(-1).newMatchReady).toEqual({ player1: false, player2: false });
  });

  it("broadcasts awarded Bela and its score to both filtered player views immediately", async () => {
    vi.useFakeTimers();
    const createBelaState = (): GameState => {
      const dealt = dealGame(createDeck());
      const caller: Player = dealt.nonDealer;
      const opponent: Player = dealt.dealer;
      const all = createDeck();
      const king = all.find(({ id }) => id === "srce-K")!;
      const queen = all.find(({ id }) => id === "srce-Q")!;
      const seven = all.find(({ id }) => id === "srce-7")!;
      const remaining = all.filter(({ id }) => ![king.id, queen.id, seven.id].includes(id));
      const callerExtras = [...remaining.filter(({ suit }) => suit === "srce"), ...remaining.filter(({ suit }) => suit !== "srce").slice(0, 3)];
      const callerIds = new Set(callerExtras.map(({ id }) => id));
      const callerCards = [king, queen, ...callerExtras];
      const opponentCards = [seven, ...remaining.filter(({ id }) => !callerIds.has(id)).slice(0, 9)];
      const assigned = new Set([...callerCards, ...opponentCards].map(({ id }) => id));
      const stack = all.filter(({ id }) => !assigned.has(id));
      const splitHand = (cards: typeof callerCards) => ({ initialCards: cards.slice(0, 6), additionalCards: cards.slice(6) });
      return {
        ...dealt,
        players: { ...dealt.players, [caller]: splitHand(callerCards), [opponent]: splitHand(opponentCards) },
        faceDownStack: stack.slice(1),
        faceUpCard: stack[0]!,
        originalFaceUpCard: stack[0]!,
        faceUpExchangeChecked: true,
        phase: "playing",
        currentPlayer: caller,
        currentBidder: null,
        bidding: { turn: 4, selectedSuit: "srce", selectedBy: caller },
        declarationComparisonResult: { winner: null, pointsAwarded: { player1: 0, player2: 0 }, scoredByPlayer: { player1: [], player2: [] } },
        declarationsByPlayer: { player1: [], player2: [] },
      };
    };
    const { io } = setup(1, createBelaState);
    const creator = io.connect("creator");
    const joiner = io.connect("joiner");
    await creator.request("room:create");
    await joiner.request("room:join", { roomCode: "K7M4XP" });
    await creator.request("room:start");
    const leadView = joiner.events("game:state").at(-1).view;
    const callerSocket = leadView.viewer === leadView.nonDealer ? joiner : creator;
    const responderSocket = callerSocket === creator ? joiner : creator;
    expect(await callerSocket.request<any>("game:play-card", { cardId: "srce-K", callBela: true })).toMatchObject({ ok: true });
    const responderView = responderSocket.events("game:state").at(-1).view;
    expect(await responderSocket.request<any>("game:play-card", { cardId: "srce-7", callBela: false })).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(1);
    const queenTurn = callerSocket.events("game:state").at(-1).view;
    expect(queenTurn.legalCardIds).toContain("srce-Q");
    expect(await callerSocket.request<any>("game:play-card", { cardId: "srce-Q", callBela: false })).toMatchObject({ ok: true });

    const callerState = callerSocket.events("game:state").at(-1);
    const opponentState = responderSocket.events("game:state").at(-1);
    for (const state of [callerState, opponentState]) {
      expect(state.view.zvanjaPointsAwarded[leadView.nonDealer]).toBe(20);
      expect(state.view.awardedZvanja[leadView.nonDealer]).toMatchObject([{ name: "Bela", points: 20, kind: "bela", cards: [{ id: "srce-K" }, { id: "srce-Q" }] }]);
    }
    expect(callerState.view.hands[leadView.dealer].cards).toEqual([]);
    expect(opponentState.view.hands[leadView.nonDealer].cards).toEqual([]);
    expect(responderView.hands[leadView.nonDealer].cards).toEqual([]);
  });
});
