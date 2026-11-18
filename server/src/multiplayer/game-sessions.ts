import { randomUUID } from "node:crypto";
import {
  acknowledgeTrick,
  dealGame,
  GameRuleError,
  getPlayerView,
  playCard,
  startNextRound,
  submitBid,
} from "../game/game-engine.js";
import type { GameState, Player, PlayerGameView, Suit } from "../game/types.js";
import { RoomManager, type PublicRoomState, type RoomPlayer } from "./room-manager.js";

export interface MultiplayerGameState {
  readonly matchId: string;
  readonly view: PlayerGameView;
  readonly room: PublicRoomState;
  readonly nextRoundReady: Readonly<Record<Player, boolean>>;
  readonly newMatchReady: Readonly<Record<Player, boolean>>;
}

export type GameActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

interface GameSession {
  state: GameState;
  readonly nextRoundVotes: Set<Player>;
  readonly newMatchVotes: Set<Player>;
  matchId: string;
  timer: ReturnType<typeof setTimeout> | null;
  timerKey: string | null;
}

export interface MultiplayerGameSessionsOptions {
  readonly trickDisplayMs?: number;
  readonly createGameState?: () => GameState;
  readonly onStateChanged?: (roomCode: string) => void;
}

function fail<T>(code: string, message: string): GameActionResult<T> {
  return { ok: false, error: { code, message } };
}

/** Owns one authoritative engine state and trick timer per started room. */
export class MultiplayerGameSessions {
  private readonly sessions = new Map<string, GameSession>();
  private readonly trickDisplayMs: number;
  private readonly createGameState: () => GameState;
  private readonly onStateChanged: (roomCode: string) => void;

  constructor(private readonly rooms: RoomManager, options: MultiplayerGameSessionsOptions = {}) {
    this.trickDisplayMs = options.trickDisplayMs ?? 1500;
    this.createGameState = options.createGameState ?? (() => dealGame());
    this.onStateChanged = options.onStateChanged ?? (() => undefined);
  }

  /** Creates the deal once. Repeated calls return created:false and preserve the existing match. */
  start(roomCode: string): GameActionResult<{ readonly created: boolean }> {
    const room = this.rooms.getRoom(roomCode);
    if (!room || room.status !== "started") return fail("GAME_NOT_STARTED", "Soba još nije započela partiju.");
    if (!room.players.player1.connected || !room.players.player2.connected) {
      return fail("OPPONENT_DISCONNECTED", "Oba igrača moraju biti povezana za početak partije.");
    }
    if (this.sessions.has(roomCode)) return { ok: true, data: { created: false } };
    this.sessions.set(roomCode, {
      state: this.createGameState(), nextRoundVotes: new Set(), newMatchVotes: new Set(), matchId: randomUUID(), timer: null, timerKey: null,
    });
    this.onStateChanged(roomCode);
    return { ok: true, data: { created: true } };
  }

  getPlayerState(roomCode: string, player: RoomPlayer): MultiplayerGameState | null {
    const session = this.sessions.get(roomCode);
    const room = this.rooms.getRoom(roomCode);
    if (!session || !room || room.status !== "started") return null;
    return {
      matchId: session.matchId,
      view: getPlayerView(session.state, player),
      room,
      nextRoundReady: { player1: session.nextRoundVotes.has("player1"), player2: session.nextRoundVotes.has("player2") },
      newMatchReady: { player1: session.newMatchVotes.has("player1"), player2: session.newMatchVotes.has("player2") },
    };
  }

  submitBid(roomCode: string, player: Player, suit: Suit | null): GameActionResult<{ readonly accepted: true }> {
    const session = this.getActionSession(roomCode);
    if (!session.ok) return session;
    try {
      session.data.state = submitBid(session.data.state, player, suit);
      this.onStateChanged(roomCode);
      return { ok: true, data: { accepted: true } };
    } catch (error) {
      return this.ruleFailure(error);
    }
  }

  play(roomCode: string, player: Player, cardId: string, callBela: boolean): GameActionResult<{ readonly accepted: true }> {
    const session = this.getActionSession(roomCode);
    if (!session.ok) return session;
    try {
      const nextState = playCard(session.data.state, player, cardId, callBela);
      session.data.state = nextState;
      if (nextState.awaitingTrickAcknowledgement && nextState.currentTrick.winner) this.scheduleTrickTransition(roomCode, session.data);
      this.onStateChanged(roomCode);
      return { ok: true, data: { accepted: true } };
    } catch (error) {
      return this.ruleFailure(error);
    }
  }

  confirmNextRound(roomCode: string, player: Player, completedRound: number): GameActionResult<{ readonly accepted: true; readonly waitingForOpponent: boolean }> {
    const session = this.getActionSession(roomCode);
    if (!session.ok) return session;
    if (session.data.state.phase !== "round-complete" || session.data.state.awaitingTrickAcknowledgement) {
      return fail("ROUND_NOT_COMPLETE", "Pričekajte završetak prikaza posljednjeg štiha prije potvrde nove runde.");
    }
    if (session.data.state.matchWinner) return fail("MATCH_COMPLETE", "Partija je završena.");
    if (completedRound !== session.data.state.roundNumber) return fail("STALE_ROUND", "Potvrda se odnosi na prethodnu rundu.");

    session.data.nextRoundVotes.add(player);
    const bothReady = session.data.nextRoundVotes.has("player1") && session.data.nextRoundVotes.has("player2");
    if (bothReady) {
      try {
        session.data.state = startNextRound(session.data.state);
        session.data.nextRoundVotes.clear();
      } catch (error) {
        session.data.nextRoundVotes.delete(player);
        return this.ruleFailure(error);
      }
    }
    this.onStateChanged(roomCode);
    return { ok: true, data: { accepted: true, waitingForOpponent: !bothReady } };
  }

  confirmNewMatch(roomCode: string, player: Player): GameActionResult<{ readonly accepted: true; readonly waitingForOpponent: boolean }> {
    const session = this.getActionSession(roomCode);
    if (!session.ok) return session;
    if (session.data.state.matchWinner === null) return fail("MATCH_NOT_COMPLETE", "Nova partija moÅ¾e poÄeti nakon zavrÅ¡etka partije do 1001 boda.");
    if (session.data.state.phase !== 'round-complete' || session.data.state.awaitingTrickAcknowledgement) {
      return fail('MATCH_NOT_COMPLETE', 'Pričekajte da završi prikaz zadnjeg štiha prije nove partije.');
    }

    session.data.newMatchVotes.add(player);
    const bothReady = session.data.newMatchVotes.has("player1") && session.data.newMatchVotes.has("player2");
    if (bothReady) {
      if (session.data.timer) clearTimeout(session.data.timer);
      session.data.timer = null;
      session.data.timerKey = null;
      session.data.state = this.createGameState();
      session.data.matchId = randomUUID();
      session.data.newMatchVotes.clear();
      session.data.nextRoundVotes.clear();
    }
    this.onStateChanged(roomCode);
    return { ok: true, data: { accepted: true, waitingForOpponent: !bothReady } };
  }

  playerLeft(roomCode: string, player: RoomPlayer): void {
    const session = this.sessions.get(roomCode);
    session?.nextRoundVotes.delete(player);
    session?.newMatchVotes.delete(player);
  }

  closeRoom(roomCode: string): void {
    const session = this.sessions.get(roomCode);
    if (session?.timer) clearTimeout(session.timer);
    this.sessions.delete(roomCode);
  }

  private getActionSession(roomCode: string): GameActionResult<GameSession> {
    const room = this.rooms.getRoom(roomCode);
    const session = this.sessions.get(roomCode);
    if (!room || room.status !== "started" || !session) return fail("GAME_NOT_STARTED", "Partija u ovoj sobi nije započela.");
    if (!room.players.player1.connected || !room.players.player2.connected) {
      return fail("OPPONENT_DISCONNECTED", "Igra se nastavlja kada se oba igrača ponovno povežu.");
    }
    return { ok: true, data: session };
  }

  private scheduleTrickTransition(roomCode: string, session: GameSession): void {
    const state = session.state;
    const key = `${state.roundNumber}:${state.tricksPlayed}:${state.currentTrick.winner}`;
    if (session.timerKey === key) return;
    if (session.timer) clearTimeout(session.timer);
    session.timerKey = key;
    session.timer = setTimeout(() => {
      if (this.sessions.get(roomCode) !== session || session.timerKey !== key) return;
      session.timer = null;
      session.timerKey = null;
      const current = session.state;
      if (!current.awaitingTrickAcknowledgement || current.tricksPlayed !== state.tricksPlayed || current.currentTrick.winner !== state.currentTrick.winner) return;
      try {
        session.state = acknowledgeTrick(current);
        this.onStateChanged(roomCode);
      } catch (error) {
        // The action is server-owned; a stale timer is ignored instead of changing match state.
        if (!(error instanceof GameRuleError)) console.error("Automatic multiplayer trick transition failed:", error);
      }
    }, this.trickDisplayMs);
  }

  private ruleFailure<T>(error: unknown): GameActionResult<T> {
    return fail("INVALID_GAME_ACTION", error instanceof Error ? error.message : "Radnja u partiji nije valjana.");
  }
}
