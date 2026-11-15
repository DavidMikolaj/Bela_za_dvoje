import express, { Router, type Response } from "express";
import {
  dealGame,
  endTestRound,
  GameRuleError,
  getPlayerView,
  acknowledgeTrick,
  playCard,
  startNextRound,
  submitBid,
} from "../game/game-engine.js";
import { SUITS, type GameState, type Player, type PlayerGameView, type Suit } from "../game/types.js";

interface LocalMatch {
  state: GameState;
  activePlayer: Player;
  scores: Record<Player, number>;
}

export interface LocalMatchResponse {
  readonly matchExists: true;
  readonly activePlayer: Player;
  readonly scores: Readonly<Record<Player, number>>;
  /** Only the active local player's filtered view is returned. */
  readonly view: PlayerGameView;
}

function toResponse(match: LocalMatch): LocalMatchResponse {
  return {
    matchExists: true,
    activePlayer: match.activePlayer,
    scores: { ...match.scores },
    view: getPlayerView(match.state, match.activePlayer),
  };
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof GameRuleError) {
    response.status(400).json({ error: error.message });
    return;
  }
  console.error("Local game API error:", error);
  response.status(500).json({ error: "The local game request failed." });
}

function otherPlayer(player: Player): Player {
  return player === "player1" ? "player2" : "player1";
}

/** In-memory local-only routes. Mount only outside production. */
export function createLocalGameRouter(): Router {
  const router = Router();
  let match: LocalMatch | null = null;
  router.use(express.json());

  router.get("/match", (_request, response) => {
    if (!match) {
      response.json({ matchExists: false });
      return;
    }
    response.json(toResponse(match));
  });

  router.post("/match", (_request, response) => {
    const state = dealGame();
    match = {
      state,
      activePlayer: state.nonDealer,
      scores: { player1: 0, player2: 0 },
    };
    response.status(201).json(toResponse(match));
  });

  router.post("/match/round", (_request, response) => {
    if (!match) return response.status(404).json({ error: "No local match exists." });
    try {
      match.state = startNextRound(match.state);
      match.activePlayer = match.state.nonDealer;
      response.json(toResponse(match));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/bid", (request, response) => {
    if (!match) return response.status(404).json({ error: "No local match exists." });
    const submittedSuit: unknown = request.body?.suit;
    if (submittedSuit !== null && !SUITS.includes(submittedSuit as Suit)) {
      response.status(400).json({ error: "Choose an allowed suit or pass." });
      return;
    }

    try {
      match.state = submitBid(match.state, match.activePlayer, submittedSuit as Suit | null);
      if (match.state.currentBidder) match.activePlayer = match.state.currentBidder;
      else if (match.state.currentPlayer) match.activePlayer = match.state.currentPlayer;
      response.json(toResponse(match));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/switch-player", (_request, response) => {
    if (!match) return response.status(404).json({ error: "No local match exists." });
    match.activePlayer = otherPlayer(match.activePlayer);
    response.json(toResponse(match));
  });

  router.post("/match/play", (request, response) => {
    if (!match) return response.status(404).json({ error: "No local match exists." });
    const cardId: unknown = request.body?.cardId;
    if (typeof cardId !== "string") {
      response.status(400).json({ error: "Choose a card from your visible hand." });
      return;
    }
    try {
      match.state = playCard(match.state, match.activePlayer, cardId);
      if (match.state.currentPlayer) match.activePlayer = match.state.currentPlayer;
      response.json(toResponse(match));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/acknowledge-trick", (_request, response) => {
    if (!match) return response.status(404).json({ error: "No local match exists." });
    try {
      match.state = acknowledgeTrick(match.state);
      if (match.state.currentPlayer) match.activePlayer = match.state.currentPlayer;
      response.json(toResponse(match));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/end-test-round", (_request, response) => {
    if (!match) return response.status(404).json({ error: "No local match exists." });
    try {
      match.state = endTestRound(match.state);
      response.json(toResponse(match));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
