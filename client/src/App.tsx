import { useEffect, useState } from "react";
import { localGameApi, type Card, type LocalMatchSnapshot, type Player, type PlayerGameView, type Suit } from "./game-api";
import { sortCardsForDisplay } from "./card-sorting";
import "./App.css";

function playerName(player: Player): string {
  return player === "player1" ? "Player 1" : "Player 2";
}

function suitClass(suit: Suit): string {
  switch (suit) {
    case "srce": return "suit-heart";
    case "tikva": return "suit-gourd";
    case "žir": return "suit-acorn";
    case "zelje": return "suit-leaf";
  }
}

function CardFace({
  card,
  onPlay,
  disabled = false,
  legal = false,
}: {
  readonly card: Card;
  readonly onPlay?: () => void;
  readonly disabled?: boolean;
  readonly legal?: boolean;
}) {
  const className = `playing-card ${suitClass(card.suit)} ${onPlay ? `selectable-card ${legal ? "legal-card" : "illegal-card"}` : ""}`;
  const content = <>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{card.suit}</span>
      <span className="card-corner" aria-hidden="true">{card.rank}</span>
    </>;

  if (onPlay) {
    return <button type="button" className={className} aria-label={`Play ${card.rank} ${card.suit}`} onClick={onPlay} disabled={disabled}>{content}</button>;
  }
  return <div className={`playing-card ${suitClass(card.suit)}`} aria-label={`${card.rank} ${card.suit}`}>{content}</div>;
}

function CardBack({ index }: { readonly index: number }) {
  return <div className="playing-card card-back" aria-label={`Face-down card ${index + 1}`}><span>BA</span></div>;
}

function PlayerArea({
  player,
  view,
  activePlayer,
  onPlayCard,
}: {
  readonly player: Player;
  readonly view: PlayerGameView;
  readonly activePlayer: Player;
  readonly onPlayCard: (cardId: string) => void;
}) {
  const isDealer = view.dealer === player;
  const hand = view.hands[player];
  const visibleCards = sortCardsForDisplay(hand.cards);
  const backCount = Math.max(0, hand.cardCount - visibleCards.length);
  const isCurrent = activePlayer === player;
  const isViewer = view.viewer === player;
  const canInteract = isViewer && isCurrent && view.phase === "playing";
  const legalCardIds = new Set(view.legalCardIds);

  return (
    <section className={`player-area ${isCurrent ? "is-active" : ""}`} aria-label={`${playerName(player)} hand`}>
      <div className="player-heading">
        <div>
          <h2>{playerName(player)}</h2>
          <p>{isDealer ? "Dealer" : "Non-dealer"}</p>
        </div>
        {isCurrent && <span className="active-pill">Viewing</span>}
        {((view.currentBidder === player && view.phase === "bidding") ||
          (view.currentPlayer === player && view.phase === "playing")) && <span className="turn-pill">To act</span>}
      </div>
      <div className="hand-cards" aria-label={`${visibleCards.length} visible, ${backCount} face-down cards`}>
        {visibleCards.map((card) => (
          <CardFace
            key={card.id}
            card={card}
            onPlay={isViewer && isCurrent && view.phase === "playing" ? () => onPlayCard(card.id) : undefined}
            disabled={!canInteract || !legalCardIds.has(card.id)}
            legal={canInteract && legalCardIds.has(card.id)}
          />
        ))}
        {Array.from({ length: backCount }, (_, index) => <CardBack key={`back-${player}-${index}`} index={index} />)}
        {hand.cardCount === 0 && <span className="empty-hand">No cards dealt</span>}
      </div>
      <p className="hand-caption">
        {visibleCards.length > 0
          ? `${visibleCards.length} shown${backCount > 0 ? ` · ${backCount} face-down` : ""}`
          : `${hand.cardCount} cards face-down`}
      </p>
    </section>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<LocalMatchSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    localGameApi.getMatch()
      .then((match) => { if (active) setSnapshot(match); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load the local match.");
      });
    return () => { active = false; };
  }, []);

  const runAction = async (action: () => Promise<LocalMatchSnapshot>) => {
    setError(null);
    // Clear the previous hot-seat player's cards before requesting the next safe view.
    setSnapshot(null);
    setBusy(true);
    try {
      setSnapshot(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The game action failed.");
      try {
        setSnapshot(await localGameApi.getMatch());
      } catch {
        // Keep all cards hidden if the server cannot provide a fresh player-specific view.
      }
    } finally {
      setBusy(false);
    }
  };

  const match = snapshot?.matchExists ? snapshot : null;
  const view = match?.view ?? null;
  const isEnded = view?.phase === "test-round-ended" ||
    (view?.phase === "round-complete" && !view.awaitingTrickAcknowledgement);
  const allowedBids = view?.allowedBids ?? [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bela za dvoje home">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span><strong>Bela za dvoje</strong><small>LOCAL TABLE</small></span>
        </a>
        <div className="topbar-actions">
          {view && <span className="hotseat-tag"><span className="online-dot" /> Hot-seat test</span>}
          <button className="button button-subtle" onClick={() => void runAction(localGameApi.newMatch)} disabled={busy}>
            New Match
          </button>
        </div>
      </header>

      <div className="page-content" id="top">
        <section className="page-heading">
          <div>
            <p className="eyebrow">TWO PLAYER · MAĐARICE</p>
            <h1>The table is yours.</h1>
          <p className="intro">A local hot-seat table for testing Bela from deal through round scoring.</p>
          </div>
          {match && (
            <div className="round-chip">
              <span>ROUND</span>
              <strong>{view!.roundNumber.toString().padStart(2, "0")}</strong>
            </div>
          )}
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => void runAction(localGameApi.getMatch)} disabled={busy}>Retry</button>
          </div>
        )}

        {!match && !busy && (
          <section className="welcome-card">
            <div className="welcome-icon" aria-hidden="true">BA</div>
            <p className="eyebrow">READY WHEN YOU ARE</p>
            <h2>Start a local match</h2>
            <p>The server will shuffle and deal the cards. Your browser receives only the active player’s view.</p>
            <button className="button button-primary button-large" onClick={() => void runAction(localGameApi.newMatch)}>
              <span aria-hidden="true">＋</span> New Match
            </button>
            {busy && <p className="muted">Connecting to the local game server…</p>}
          </section>
        )}

        {match && view && (
          <>
            <section className="status-strip" aria-label="Match status">
              <div className="status-item">
                <span className="status-icon">◷</span>
                <div><small>ROUND</small><strong>{view.roundNumber}</strong></div>
              </div>
              <div className="status-item">
                <span className="status-icon">♟</span>
                <div><small>DEALER</small><strong>{playerName(view.dealer)}</strong></div>
              </div>
              <div className="status-item">
                <span className="status-icon">↗</span>
                <div><small>NON-DEALER</small><strong>{playerName(view.nonDealer)}</strong></div>
              </div>
              <div className="status-item bidding-status">
                <span className="status-icon">◎</span>
                <div><small>{view.currentBidder ? "BIDDING TURN" : view.currentPlayer ? "CARD PLAY" : "ROUND STATUS"}</small>
                  <strong>{view.currentBidder ? playerName(view.currentBidder) : view.currentPlayer ? playerName(view.currentPlayer) : phaseLabel(view.phase)}</strong></div>
              </div>
            </section>

            <section className="scoreboard" aria-label="Scoreboard">
              <div className="score-title"><span className="score-dot" /> MATCH SCORE <small>FIRST TO 1001</small></div>
              <div className="score-player"><span>Player 1</span><strong>{view.matchScores.player1}</strong></div>
              <span className="score-divider">—</span>
              <div className="score-player"><span>Player 2</span><strong>{view.matchScores.player2}</strong></div>
            </section>

            <section className="trick-scoreboard" aria-label="Trick results">
              <span className="trick-score-title">ROUND SCORE</span>
              <div><span>Player 1</span><strong>{view.tricksWon.player1} tricks · {view.trickPoints.player1} pts</strong><small>{view.collectedCardCounts.player1} cards collected</small></div>
              <span className="score-divider">—</span>
              <div><span>Player 2</span><strong>{view.tricksWon.player2} tricks · {view.trickPoints.player2} pts</strong><small>{view.collectedCardCounts.player2} cards collected</small></div>
              <span className="trick-progress">{view.tricksPlayed} / 10 tricks</span>
            </section>

            <section className="table" aria-label="Bela table">
              <div className="felt-grain" aria-hidden="true" />
              <PlayerArea player="player2" view={view} activePlayer={match.activePlayer}
                onPlayCard={(cardId) => void runAction(() => localGameApi.playCard(cardId))} />

              <div className="table-center">
                <div className="table-rule" />
                <div className="center-cards">
                  <div className="deck-stack" aria-label={`${view.faceDownStackCount} face-down cards remain`}>
                    <CardBack index={0} />
                    <span className="deck-count">{view.faceDownStackCount}<small>CARDS</small></span>
                  </div>
                  <div className="upcard-wrap">
                    <span className="center-label">FACE-UP CARD</span>
                    <CardFace card={view.faceUpCard} />
                  </div>
                </div>
                {(view.phase === "playing" || view.currentTrick.cards.length > 0) && (
                  <div className="trick-display" aria-live="polite">
                    <div className="trick-display-heading">
                      <span>TRICK {view.currentTrick.number} <i>/ 10</i></span>
                      {view.currentTrick.winner && <strong>{playerName(view.currentTrick.winner)} won</strong>}
                      {!view.currentTrick.winner && <strong>{view.currentPlayer
                        ? (view.currentTrick.cards.length === 0 ? "Lead a card" : `Waiting for ${playerName(view.currentPlayer)}`)
                        : "Test ended before this trick finished"}</strong>}
                    </div>
                    <div className="trick-cards">
                      {view.currentTrick.cards.map(({ player, card }) => (
                        <div className="played-card" key={`${view.currentTrick.number}-${player}`}>
                          <span>{playerName(player)}</span><CardFace card={card} />
                        </div>
                      ))}
                      {Array.from({ length: 2 - view.currentTrick.cards.length }, (_, index) => (
                        <div className="played-card" key={`waiting-${index}`}>
                          <span>—</span><div className="card-slot">?</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="table-rule" />
                <div className="bidding-panel" aria-live="polite">
                  {view.phase === "bidding" && (
                    <>
                      <p className="eyebrow">ADUT · TURN {view.bidding.turn}</p>
                      <h2>{match.activePlayer === view.currentBidder
                        ? `${playerName(match.activePlayer)}, choose your call`
                        : `Waiting for ${playerName(view.currentBidder!)}`}</h2>
                      {allowedBids.length > 0 ? (
                        <div className="bid-actions">
                          {allowedBids.map((bid) => bid === null ? (
                            <button className="button button-pass" key="pass" onClick={() => void runAction(() => localGameApi.submitBid(null))} disabled={busy}>Pass</button>
                          ) : (
                            <button className="button button-suit" key={bid} onClick={() => void runAction(() => localGameApi.submitBid(bid))} disabled={busy}>
                              Call <strong>{bid}</strong>
                            </button>
                          ))}
                        </div>
                      ) : <p className="small-note">Switch to the player whose turn it is to bid.</p>}
                    </>
                  )}
                  {view.phase === "playing" && (
                    <>
                      <p className="eyebrow">TRICK {view.currentTrick.number} OF 10 · ADUT {view.bidding.selectedSuit}</p>
                      <h2>{view.currentPlayer === match.activePlayer
                        ? `${playerName(match.activePlayer)}, play a highlighted card`
                        : `Waiting for ${playerName(view.currentPlayer!)}`}</h2>
                      <p className="small-note">Adut called by {playerName(view.bidding.selectedBy!)} · legal cards are highlighted · Bela: {view.belaPoints[match.activePlayer]} pts</p>
                    </>
                  )}
                  {view.phase === "trick-complete" && (
                    <>
                      <p className="eyebrow">TRICK {view.currentTrick.number} COMPLETE</p>
                      <h2>{playerName(view.currentTrick.winner!)} wins the trick</h2>
                      <p className="small-note">The played cards remain visible until you acknowledge the result.</p>
                      <button className="button button-primary trick-ack-button" onClick={() => void runAction(localGameApi.acknowledgeTrick)} disabled={busy}>Acknowledge trick <span aria-hidden="true">→</span></button>
                    </>
                  )}
                  {view.phase === "test-round-ended" && (
                    <>
                      <p className="eyebrow">DEVELOPMENT TEST ENDED</p>
                      <h2>Test round ended</h2>
                      <p className="small-note">No card play was completed and no points were awarded.</p>
                    </>
                  )}
                  {view.phase === "round-complete" && (
                    <>
                      <p className="eyebrow">ROUND COMPLETE · 10 TRICKS</p>
                      <h2>Round complete</h2>
                      <p className="small-note">{view.tricksWon.player1} tricks for Player 1 · {view.tricksWon.player2} tricks for Player 2</p>
                      {view.roundScore && <RoundResult view={view} />}
                      {view.matchWinner && <h3 className="match-winner">{playerName(view.matchWinner)} wins the match!</h3>}
                      {view.awaitingTrickAcknowledgement && <button className="button button-primary trick-ack-button" onClick={() => void runAction(localGameApi.acknowledgeTrick)} disabled={busy}>Acknowledge final trick <span aria-hidden="true">→</span></button>}
                    </>
                  )}
                </div>
              </div>

              <PlayerArea player="player1" view={view} activePlayer={match.activePlayer}
                onPlayCard={(cardId) => void runAction(() => localGameApi.playCard(cardId))} />
            </section>

            <section className="controls-row" aria-label="Local development controls">
              <div className="handoff-copy">
                <span className="handoff-icon">⇄</span>
                <div><strong>Hot-seat handoff</strong><p>Pass the device, then reveal the next player’s hand.</p></div>
              </div>
              <div className="control-buttons">
                <button className="button button-subtle" onClick={() => void runAction(localGameApi.switchPlayer)} disabled={busy}>
                  Switch Player <span aria-hidden="true">↗</span>
                </button>
                {isEnded && !view.matchWinner ? (
                  <button className="button button-primary" onClick={() => void runAction(localGameApi.startNextRound)} disabled={busy}>
                    Start Next Round <span aria-hidden="true">→</span>
                  </button>
                ) : (view.phase === "bidding" || view.phase === "playing") ? (
                  <button className="button button-danger-quiet" onClick={() => void runAction(localGameApi.endTestRound)} disabled={busy}>
                    End Test Round
                  </button>
                ) : null}
              </div>
            </section>
            <ZvanjaPanel view={view} viewer={match.activePlayer} />
            <p className="dev-disclaimer">Development-only hot-seat controls · not multiplayer authentication · no zvanja announcements or additional gameplay rules.</p>
          </>
        )}
      </div>
    </main>
  );
}

function ZvanjaPanel({ view, viewer }: { readonly view: PlayerGameView; readonly viewer: Player }) {
  const isComplete = view.phase === "round-complete";
  const evaluated = view.bidding.selectedSuit !== null;
  const renderedPlayers: readonly Player[] = !evaluated ? [] : isComplete ? ["player1", "player2"] : [viewer];
  return <section className="zvanja-panel" aria-label="Zvanja">
    <div><h2>Zvanja & Bela</h2><p>{!evaluated ? "Zvanja are checked after adut selection and the Seven exchange." : isComplete ? "Both players’ melds are revealed after the round." : "Your zvanja only; opponent melds stay hidden until the round ends."}</p></div>
    {renderedPlayers.map((player) => <div className="zvanja-player" key={player}>
      <strong>{playerName(player)}</strong>
      <div className="zvanja-list">
        {view.ordinaryZvanjaByPlayer[player].length ? view.ordinaryZvanjaByPlayer[player].map((meld, index) => <span key={`${meld.kind}-${index}`}>
          {meld.kind === "sequence" ? `${meld.sequenceLength}-card run` : `Four ${meld.rank}s`} · {meld.points} pts
        </span>) : <span>No ordinary zvanja</span>}
      </div>
    </div>)}
    {isComplete && view.ordinaryZvanjaResult && <p className="small-note">
      Zvanja: {view.ordinaryZvanjaResult.winner ? `${playerName(view.ordinaryZvanjaResult.winner)} wins ${view.ordinaryZvanjaResult.pointsAwarded[view.ordinaryZvanjaResult.winner]} pts` : "no point-bearing zvanja"}
      {` · Bela: ${view.belaPoints.player1}–${view.belaPoints.player2}`}
    </p>}
  </section>;
}

function RoundResult({ view }: { readonly view: PlayerGameView }) {
  const score = view.roundScore!;
  return <div className="round-result" aria-label="Round score breakdown">
    <h3>{score.contractSucceeded ? "Contract succeeded" : "Contract failed"} · caller {playerName(score.caller)}</h3>
    <p>Tricks: Player 1 {score.trickPoints.player1} · Player 2 {score.trickPoints.player2}</p>
    <p>Zvanja: Player 1 {score.ordinaryZvanjaPoints.player1} · Player 2 {score.ordinaryZvanjaPoints.player2}</p>
    <p>Bela: Player 1 {score.belaPoints.player1} · Player 2 {score.belaPoints.player2}</p>
    <p>Last trick: Player 1 {score.lastTrickBonus.player1} · Player 2 {score.lastTrickBonus.player2}</p>
    <p>Stiglja: Player 1 {score.stigljaBonus.player1} · Player 2 {score.stigljaBonus.player2}</p>
    <p>Round totals: Player 1 {score.roundTotals.player1} · Player 2 {score.roundTotals.player2}</p>
    <p>Match points: Player 1 +{score.matchPointsAwarded.player1} · Player 2 +{score.matchPointsAwarded.player2}</p>
  </div>;
}

function phaseLabel(phase: PlayerGameView["phase"]): string {
  switch (phase) {
    case "bidding": return "Bidding";
    case "playing": return "Card play";
    case "trick-complete": return "Trick result";
    case "round-complete": return "Complete";
    case "test-round-ended": return "Test ended";
  }
}

export default App;
