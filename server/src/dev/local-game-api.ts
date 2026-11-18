import express, { Router, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  dealGame,
  endTestRound,
  GameRuleError,
  getPlayerView,
  getBelaAnnouncementCardIds,
  acknowledgeTrick,
  playCard,
  startNextRound,
  submitBid,
} from "../game/game-engine.js";
import { SUITS, type GameState, type Player, type PlayerGameView, type Suit } from "../game/types.js";

interface LocalMatch {
  state: GameState;
  activePlayer: Player;
  matchId: string;
}

export interface LocalMatchResponse {
  readonly matchExists: true;
  readonly matchId: string;
  readonly activePlayer: Player;
  readonly scores: Readonly<Record<Player, number>>;
  readonly trickTransitionAt: number | null;
  /** Only the active local player's filtered view is returned. */
  readonly view: PlayerGameView;
}

export interface LocalGameRouterOptions {
  readonly trickDisplayMs?: number;
  readonly createGameState?: () => GameState;
}

function toResponse(match: LocalMatch, trickTransitionAt: number | null): LocalMatchResponse {
  return {
    matchExists: true,
    matchId: match.matchId,
    activePlayer: match.activePlayer,
    scores: { ...match.state.matchScores },
    trickTransitionAt,
    view: getPlayerView(match.state, match.activePlayer),
  };
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof GameRuleError) {
    response.status(400).json({ error: error.message });
    return;
  }
  console.error("Local game API error:", error);
  response.status(500).json({ error: "Zahtjev za lokalnu igru nije uspio." });
}

function otherPlayer(player: Player): Player {
  return player === "player1" ? "player2" : "player1";
}

/** In-memory local-only routes. Mount only outside production. */
export function createLocalGameRouter(options: LocalGameRouterOptions = {}): Router {
  const router = Router();
  let match: LocalMatch | null = null;
  let trickTransitionTimer: ReturnType<typeof setTimeout> | null = null;
  let trickTransitionAt: number | null = null;
  let scheduledTrickKey: string | null = null;
  const trickDisplayMs = options.trickDisplayMs ?? 1500;
  router.use(express.json());

  const cancelTrickTransition = () => {
    if (trickTransitionTimer) clearTimeout(trickTransitionTimer);
    trickTransitionTimer = null;
    trickTransitionAt = null;
    scheduledTrickKey = null;
  };

  const scheduleTrickTransition = (scheduledMatch: LocalMatch) => {
    const state = scheduledMatch.state;
    if (!state.awaitingTrickAcknowledgement || !state.currentTrick.winner) return;
    const key = `${state.roundNumber}:${state.tricksPlayed}:${state.currentTrick.winner}`;
    if (scheduledTrickKey === key) return;
    cancelTrickTransition();
    scheduledTrickKey = key;
    trickTransitionAt = Date.now() + trickDisplayMs;
    trickTransitionTimer = setTimeout(() => {
      if (match !== scheduledMatch || scheduledTrickKey !== key) return;
      const latest = scheduledMatch.state;
      if (!latest.awaitingTrickAcknowledgement || latest.currentTrick.winner !== state.currentTrick.winner || latest.tricksPlayed !== state.tricksPlayed) return;
      try {
        scheduledMatch.state = acknowledgeTrick(latest);
        if (scheduledMatch.state.currentPlayer) scheduledMatch.activePlayer = scheduledMatch.state.currentPlayer;
      } catch (error) {
        console.error("Automatic trick transition failed:", error);
      } finally {
        trickTransitionTimer = null;
        trickTransitionAt = null;
        scheduledTrickKey = null;
      }
    }, trickDisplayMs);
  };

  router.get("/match", (_request, response) => {
    if (!match) {
      response.json({ matchExists: false });
      return;
    }
    response.json(toResponse(match, trickTransitionAt));
  });

  router.post("/match", (_request, response) => {
    cancelTrickTransition();
    const state = options.createGameState?.() ?? dealGame();
    match = {
      state,
      activePlayer: state.nonDealer,
      matchId: randomUUID(),
    };
    response.status(201).json(toResponse(match, trickTransitionAt));
  });

  router.post("/match/round", (_request, response) => {
    if (!match) return response.status(404).json({ error: "Lokalna partija ne postoji." });
    try {
      const nextState = startNextRound(match.state);
      cancelTrickTransition();
      match.state = nextState;
      match.activePlayer = match.state.nonDealer;
      response.json(toResponse(match, trickTransitionAt));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/bid", (request, response) => {
    if (!match) return response.status(404).json({ error: "Lokalna partija ne postoji." });
    const submittedSuit: unknown = request.body?.suit;
    if (submittedSuit !== null && !SUITS.includes(submittedSuit as Suit)) {
      response.status(400).json({ error: "Odaberite dopuštenu boju aduta ili prođite." });
      return;
    }

    try {
      match.state = submitBid(match.state, match.activePlayer, submittedSuit as Suit | null);
      if (match.state.currentBidder) match.activePlayer = match.state.currentBidder;
      else if (match.state.currentPlayer) match.activePlayer = match.state.currentPlayer;
      response.json(toResponse(match, trickTransitionAt));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/switch-player", (_request, response) => {
    if (!match) return response.status(404).json({ error: "Lokalna partija ne postoji." });
    match.activePlayer = otherPlayer(match.activePlayer);
    response.json(toResponse(match, trickTransitionAt));
  });

  router.post("/match/play", (request, response) => {
    if (!match) return response.status(404).json({ error: "Lokalna partija ne postoji." });
    const cardId: unknown = request.body?.cardId;
    if (typeof cardId !== "string") {
      response.status(400).json({ error: "Odaberite kartu iz svoje vidljive ruke." });
      return;
    }
    const callBela: unknown = request.body?.callBela;
    try {
      const canCallBela = getBelaAnnouncementCardIds(match.state, match.activePlayer).includes(cardId);
      if (canCallBela && typeof callBela !== "boolean") {
        response.status(400).json({ error: "Odaberite želite li zvati Belu prije odigravanja kralja ili dame aduta." });
        return;
      }
      if (callBela !== undefined && typeof callBela !== "boolean") {
        response.status(400).json({ error: "Odluka o zvanju Bele nije valjana." });
        return;
      }
      const previousTricksPlayed = match.state.tricksPlayed;
      match.state = playCard(match.state, match.activePlayer, cardId, callBela === true);
      if (match.state.currentPlayer) match.activePlayer = match.state.currentPlayer;
      if (match.state.tricksPlayed > previousTricksPlayed && match.state.awaitingTrickAcknowledgement) {
        scheduleTrickTransition(match);
      }
      response.json(toResponse(match, trickTransitionAt));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/match/end-test-round", (_request, response) => {
    if (!match) return response.status(404).json({ error: "Lokalna partija ne postoji." });
    try {
      match.state = endTestRound(match.state);
      cancelTrickTransition();
      response.json(toResponse(match, trickTransitionAt));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
