import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalGameRouter } from "../src/dev/local-game-api.js";
import { createDeck } from "../src/game/cards.js";
import { dealGame } from "../src/game/game-engine.js";
import { SUITS, type GameState } from "../src/game/types.js";

const servers: ReturnType<typeof createServer>[] = [];

async function startApi(trickDisplayMs = 1500, createGameState?: () => GameState) {
  const app = express();
  app.use("/api/dev", createLocalGameRouter({ trickDisplayMs, createGameState }));
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

  return { json, baseUrl };
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
    expect(payload.view.viewer).toBe("player2");
    expect(payload.view.currentBidder).toBe("player2");
    expect(payload.view.hands.player2.cards).toHaveLength(6);
    expect(payload.view.hands.player2.hiddenCardCount).toBe(4);
    expect(payload.view.hands.player1.cards).toEqual([]);
    expect(payload.view.allowedBids).toEqual([payload.view.faceUpCard.suit, null]);
    expect(payload.scores).toEqual({ player1: 0, player2: 0 });
    expect(payload.view.trickPoints).toEqual({ player1: 0, player2: 0 });
    expect(payload.view.zvanjaPointsAwarded).toEqual({ player1: 0, player2: 0 });
    expect(JSON.stringify(payload)).not.toContain("additionalCards");
    expect(payload.view).not.toHaveProperty("faceDownStack");
    expect(payload.view.faceDownStackCount).toBe(11);
  });

  it("requires an explicit Bela decision for an eligible King or Queen play", async () => {
    const createGameState = (): GameState => {
      const dealt = dealGame(createDeck());
      const progress = { called: false, kingPlayed: false, queenPlayed: false, awarded: false, kingCard: null, queenCard: null };
      return {
        ...dealt,
        phase: "playing",
        currentBidder: null,
        currentPlayer: dealt.nonDealer,
        players: {
          player1: { initialCards: [{ id: "api-response", suit: "srce", rank: "7" }], additionalCards: [] },
          player2: {
            initialCards: [
              { id: "api-king", suit: "srce", rank: "K" },
              { id: "api-queen", suit: "srce", rank: "Q" },
            ],
            additionalCards: [],
          },
        },
        bidding: { turn: 1, selectedSuit: "srce", selectedBy: dealt.nonDealer },
        belaProgress: { player1: progress, player2: progress },
        belaPoints: { player1: 0, player2: 0 },
      };
    };
    const { json } = await startApi(25, createGameState);
    const created = (await json("/match", "POST")).payload;
    expect(created.view.belaAnnouncementCardIds).toEqual(["api-king", "api-queen"]);

    const missingChoice = await json("/match/play", "POST", { cardId: "api-king" });
    expect(missingChoice.response.status).toBe(400);
    expect(missingChoice.payload.error).toMatch(/zvati Belu/i);

    const declined = (await json("/match/play", "POST", { cardId: "api-king", callBela: false })).payload;
    expect(declined.view.currentTrick.cards[0].card.id).toBe("api-king");
    expect(declined.view.zvanjaPointsAwarded.player2).toBe(0);

    const completedTrick = (await json("/match/play", "POST", { cardId: "api-response", callBela: false })).payload;
    expect(completedTrick.view.phase).toBe("trick-complete");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const refreshed = (await json("/match")).payload;
    expect(refreshed.view.currentPlayer).toBe("player2");
    expect(refreshed.view.belaAnnouncementCardIds).toEqual(["api-queen"]);

    const missingSecondChoice = await json("/match/play", "POST", { cardId: "api-queen" });
    expect(missingSecondChoice.response.status).toBe(400);
    const completedBela = (await json("/match/play", "POST", { cardId: "api-queen", callBela: true })).payload;
    expect(completedBela.view.zvanjaPointsAwarded.player2).toBe(20);
    expect(completedBela.view.awardedZvanja.player2).toMatchObject([
      { name: "Bela", points: 20, cards: [
        { id: "api-king", rank: "K", suit: "srce" },
        { id: "api-queen", rank: "Q", suit: "srce" },
      ] },
    ]);
  });

  it("persists the active local player across refresh and clears the old hand on switch", async () => {
    const { json } = await startApi();
    const created = (await json("/match", "POST")).payload;
    const refreshed = (await json("/match")).payload;
    expect(refreshed).toEqual(created);

    const switched = (await json("/match/switch-player", "POST")).payload;
    expect(switched.activePlayer).toBe("player1");
    expect(switched.view.viewer).toBe("player1");
    expect(switched.view.dealer).toBe("player1");
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
    expect(wrongPlayer.payload.error).toMatch(/red na igrača/i);
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
    expect(call.view.phase).toBe("playing");
    expect(call.view.bidding.selectedBy).toBe("player1");
  });

  it("reveals ten cards only to the player who calls adut", async () => {
    const { json } = await startApi();
    const created = (await json("/match", "POST")).payload;
    const selected = (await json("/match/bid", "POST", { suit: created.view.faceUpCard.suit })).payload;

    expect(selected.view.phase).toBe("playing");
    expect(selected.view.bidding.selectedBy).toBe("player2");
    expect(selected.view.hands.player2.cards).toHaveLength(10);
    expect(selected.view.hands.player1.cards).toEqual([]);
    expect(selected.view.allowedBids).toEqual([]);
    expect(JSON.stringify(selected)).not.toContain("additionalCards");

    const otherPlayerView = (await json("/match/switch-player", "POST")).payload;
    expect(otherPlayerView.view.hands.player1.cards).toHaveLength(10);
    expect(otherPlayerView.view.hands.player2.cards).toEqual([]);
  });

  it("automatically advances one completed trick after its server-owned display delay", async () => {
    const { json, baseUrl } = await startApi(35);
    const created = (await json("/match", "POST")).payload;
    const called = (await json("/match/bid", "POST", { suit: created.view.faceUpCard.suit })).payload;
    const leadCard = called.view.hands.player2.cards[0];

    const responseView = (await json("/match/play", "POST", { cardId: leadCard.id })).payload;
    expect(responseView.view.phase).toBe("playing");
    expect(responseView.activePlayer).toBe("player1");
    expect(responseView.view.currentPlayer).toBe("player1");
    expect(responseView.view.currentTrick.cards).toHaveLength(1);
    expect(responseView.view.hands.player2.cards).toEqual([]);
    const publiclyAwardedCardIds = Object.values(responseView.view.awardedZvanja)
      .flatMap((items: any) => items.flatMap((item: any) => item.cards.map((card: { id: string }) => card.id)));
    const privateOpponentCard = called.view.hands.player2.cards.find((card: { id: string }) => card.id !== leadCard.id && !publiclyAwardedCardIds.includes(card.id));
    if (privateOpponentCard) expect(JSON.stringify(responseView)).not.toContain(privateOpponentCard.id);

    const opponentCard = called.view.hands.player2.cards.find((card: { id: string }) => card.id !== leadCard.id);
    const rejected = await json("/match/play", "POST", { cardId: opponentCard.id });
    expect(rejected.response.status).toBe(400);

    const legalId = responseView.view.legalCardIds[0];
    const result = (await json("/match/play", "POST", { cardId: legalId })).payload;
    expect(result.view.phase).toBe("trick-complete");
    expect(result.view.currentTrick.cards).toHaveLength(2);
    expect(result.view.currentTrick.winner).toMatch(/player[12]/);
    expect(result.view.awaitingTrickAcknowledgement).toBe(true);
    expect(result.trickTransitionAt).toBeGreaterThan(Date.now());
    expect((await json("/match")).payload.view.currentTrick).toEqual(result.view.currentTrick);
    const blockedDuringDisplay = await json("/match/play", "POST", { cardId: legalId });
    expect(blockedDuringDisplay.response.status).toBe(400);
    expect((await json("/match/round", "POST")).response.status).toBe(400);
    const removedManualConfirmation = await fetch(`${baseUrl}/match/acknowledge-trick`, { method: "POST" });
    expect(removedManualConfirmation.status).toBe(404);

    await new Promise((resolve) => setTimeout(resolve, 55));
    const nextTrick = (await json("/match")).payload;
    expect(nextTrick.view.phase).toBe("playing");
    expect(nextTrick.view.currentPlayer).toBe(result.view.currentTrick.winner);
    expect(nextTrick.activePlayer).toBe(result.view.currentTrick.winner);
    expect(nextTrick.view.currentTrick.cards).toEqual([]);
    expect(nextTrick.view.tricksPlayed).toBe(1);
    expect(nextTrick.view.currentTrick.number).toBe(2);
    expect(nextTrick.trickTransitionAt).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 45));
    const stillNextTrick = (await json("/match")).payload;
    expect(stillNextTrick.view.currentTrick.number).toBe(2);
    expect(stillNextTrick.view.tricksPlayed).toBe(1);
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
