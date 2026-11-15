import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalGameRouter } from "../src/dev/local-game-api.js";
import { SUITS } from "../src/game/types.js";

const servers: ReturnType<typeof createServer>[] = [];

async function startApi() {
  const app = express();
  app.use("/api/dev", createLocalGameRouter());
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/dev`;

  async function json(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, payload: await response.json() as Record<string, any> };
  }

  return { json };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("local hot-seat game API", () => {
  it("creates a match and exposes only the non-dealer's initial hand", async () => {
    const { json } = await startApi();
    const { response, payload } = await json("/match", "POST");

    expect(response.status).toBe(201);
    expect(payload.view.roundNumber).toBe(1);
    expect(payload.view.dealer).toBe("player1");
    expect(payload.view.nonDealer).toBe("player2");
    expect(payload.activePlayer).toBe("player2");
    expect(payload.view.currentBidder).toBe("player2");
    expect(payload.view.hands.player2.cards).toHaveLength(6);
    expect(payload.view.hands.player2.hiddenCardCount).toBe(4);
    expect(payload.view.hands.player1.cards).toEqual([]);
    expect(payload.view.allowedBids).toEqual([payload.view.faceUpCard.suit, null]);
    expect(payload.scores).toEqual({ player1: 0, player2: 0 });
    expect(JSON.stringify(payload)).not.toContain("additionalCards");
    expect(payload.view).not.toHaveProperty("faceDownStack");
    expect(payload.view.faceDownStackCount).toBe(11);
  });

  it("persists the active local player across refresh and clears the old hand on switch", async () => {
    const { json } = await startApi();
    const created = (await json("/match", "POST")).payload;
    const refreshed = (await json("/match")).payload;
    expect(refreshed).toEqual(created);

    const switched = (await json("/match/switch-player", "POST")).payload;
    expect(switched.activePlayer).toBe("player1");
    expect(switched.view.viewer).toBe("player1");
    expect(switched.view.hands.player1.cards).toHaveLength(6);
    expect(switched.view.hands.player2.cards).toEqual([]);
    expect(JSON.stringify(switched)).not.toContain(created.view.hands.player2.cards[0].id);
  });

  it("enforces the active player's bidding turn and advances the hot-seat handoff", async () => {
    const { json } = await startApi();
    const created = (await json("/match", "POST")).payload;
    await json("/match/switch-player", "POST");

    const wrongPlayer = await json("/match/bid", "POST", { suit: created.view.faceUpCard.suit });
    expect(wrongPlayer.response.status).toBe(400);
    expect(wrongPlayer.payload.error).toMatch(/turn/i);
    expect(wrongPlayer.payload).not.toHaveProperty("view");

    await json("/match/switch-player", "POST");
    const passed = (await json("/match/bid", "POST", { suit: null })).payload;
    expect(passed.view.bidding.turn).toBe(2);
    expect(passed.activePlayer).toBe("player1");
    expect(passed.view.currentBidder).toBe("player1");
    expect(passed.view.hands.player1.cards).toHaveLength(6);
    expect(passed.view.hands.player2.cards).toEqual([]);
    expect(passed.view.allowedBids).toEqual([passed.view.faceUpCard.suit, null]);
  });

  it("offers only legal bidding choices and makes the fourth turn mandatory", async () => {
    const { json } = await startApi();
    const initial = (await json("/match", "POST")).payload;
    const upSuit = initial.view.faceUpCard.suit;

    await json("/match/bid", "POST", { suit: null }); // non-dealer passes
    await json("/match/bid", "POST", { suit: null }); // dealer passes
    const turn3 = (await json("/match/bid", "POST", { suit: null })).payload; // non-dealer passes
    expect(turn3.view.bidding.turn).toBe(4);
    expect(turn3.view.currentBidder).toBe("player1");
    const legalAlternateSuits = SUITS.filter((candidate) => candidate !== upSuit);
    expect(turn3.view.allowedBids).toEqual(legalAlternateSuits);
    expect(turn3.view.allowedBids).not.toContain(null);

    const passOnFour = await json("/match/bid", "POST", { suit: null });
    expect(passOnFour.response.status).toBe(400);
    const call = (await json("/match/bid", "POST", { suit: legalAlternateSuits[0] })).payload;
    expect(call.view.phase).toBe("adut-selected");
    expect(call.view.bidding.selectedBy).toBe("player1");
  });

  it("reveals ten cards only to the player who calls adut", async () => {
    const { json } = await startApi();
    const created = (await json("/match", "POST")).payload;
    const selected = (await json("/match/bid", "POST", { suit: created.view.faceUpCard.suit })).payload;

    expect(selected.view.phase).toBe("adut-selected");
    expect(selected.view.bidding.selectedBy).toBe("player2");
    expect(selected.view.hands.player2.cards).toHaveLength(10);
    expect(selected.view.hands.player1.cards).toEqual([]);
    expect(selected.view.allowedBids).toEqual([]);
    expect(JSON.stringify(selected)).not.toContain("additionalCards");

    const otherPlayerView = (await json("/match/switch-player", "POST")).payload;
    expect(otherPlayerView.view.hands.player1.cards).toHaveLength(10);
    expect(otherPlayerView.view.hands.player2.cards).toEqual([]);
  });

  it("ends a development test without points and rotates the dealer once on the next round", async () => {
    const { json } = await startApi();
    const created = (await json("/match", "POST")).payload;
    const prematureRound = await json("/match/round", "POST");
    expect(prematureRound.response.status).toBe(400);

    const ended = (await json("/match/end-test-round", "POST")).payload;
    expect(ended.view.phase).toBe("test-round-ended");
    expect(ended.scores).toEqual({ player1: 0, player2: 0 });
    expect(ended.view.hands.player2.cards).toHaveLength(6);
    expect(ended.view.hands.player2.hiddenCardCount).toBe(4);
    expect(ended.view.allowedBids).toEqual([]);

    const round2 = (await json("/match/round", "POST")).payload;
    expect(round2.view.roundNumber).toBe(2);
    expect(round2.view.dealer).toBe("player2");
    expect(round2.view.nonDealer).toBe("player1");
    expect(round2.activePlayer).toBe("player1");
    expect(round2.view.hands.player1.cards).toHaveLength(6);
    expect(round2.view.hands.player2.cards).toEqual([]);
    expect(round2.scores).toEqual(created.scores);

    const duplicateAdvance = await json("/match/round", "POST");
    expect(duplicateAdvance.response.status).toBe(400);
  });
});
