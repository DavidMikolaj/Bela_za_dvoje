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

function CardFace({ card }: { readonly card: Card }) {
  return (
    <div className={`playing-card ${suitClass(card.suit)}`} aria-label={`${card.rank} ${card.suit}`}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{card.suit}</span>
      <span className="card-corner" aria-hidden="true">{card.rank}</span>
    </div>
  );
}

function CardBack({ index }: { readonly index: number }) {
  return <div className="playing-card card-back" aria-label={`Face-down card ${index + 1}`}><span>BA</span></div>;
}

function PlayerArea({
  player,
  view,
  activePlayer,
}: {
  readonly player: Player;
  readonly view: PlayerGameView;
  readonly activePlayer: Player;
}) {
  const isDealer = view.dealer === player;
  const hand = view.hands[player];
  const visibleCards = sortCardsForDisplay(hand.cards);
  const backCount = Math.max(0, hand.cardCount - visibleCards.length);
  const isCurrent = activePlayer === player;

  return (
    <section className={`player-area ${isCurrent ? "is-active" : ""}`} aria-label={`${playerName(player)} hand`}>
      <div className="player-heading">
        <div>
          <h2>{playerName(player)}</h2>
          <p>{isDealer ? "Dealer" : "Non-dealer"}</p>
        </div>
        {isCurrent && <span className="active-pill">Viewing</span>}
        {view.currentBidder === player && view.phase === "bidding" && <span className="turn-pill">To bid</span>}
      </div>
      <div className="hand-cards" aria-label={`${visibleCards.length} visible, ${backCount} face-down cards`}>
        {visibleCards.map((card) => <CardFace key={card.id} card={card} />)}
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
  const isEnded = view?.phase === "round-complete" || view?.phase === "test-round-ended";
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
            <p className="intro">A local hot-seat table for testing the deal and adut bidding.</p>
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
                <div><small>{view.currentBidder ? "BIDDING TURN" : "ROUND STATUS"}</small>
                  <strong>{view.currentBidder ? playerName(view.currentBidder) : phaseLabel(view.phase)}</strong></div>
              </div>
            </section>

            <section className="scoreboard" aria-label="Scoreboard">
              <div className="score-title"><span className="score-dot" /> SCOREBOARD <small>TEST SCORES</small></div>
              <div className="score-player"><span>Player 1</span><strong>{match.scores.player1}</strong></div>
              <span className="score-divider">—</span>
              <div className="score-player"><span>Player 2</span><strong>{match.scores.player2}</strong></div>
            </section>

            <section className="table" aria-label="Bela table">
              <div className="felt-grain" aria-hidden="true" />
              <PlayerArea player="player2" view={view} activePlayer={match.activePlayer} />

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
                  {view.phase === "adut-selected" && (
                    <>
                      <p className="eyebrow">ADUT SELECTED</p>
                      <h2><span className={`suit-word ${suitClass(view.bidding.selectedSuit!)}`}>{view.bidding.selectedSuit}</span></h2>
                      <p className="small-note">Called by {playerName(view.bidding.selectedBy!)} · both players can now see their own ten cards</p>
                      <div className="coming-soon"><span>✦</span> Card play coming soon</div>
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
                    <><p className="eyebrow">ROUND COMPLETE</p><h2>Round complete</h2></>
                  )}
                </div>
              </div>

              <PlayerArea player="player1" view={view} activePlayer={match.activePlayer} />
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
                {isEnded ? (
                  <button className="button button-primary" onClick={() => void runAction(localGameApi.startNextRound)} disabled={busy}>
                    Start Next Round <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <button className="button button-danger-quiet" onClick={() => void runAction(localGameApi.endTestRound)} disabled={busy}>
                    End Test Round
                  </button>
                )}
              </div>
            </section>
            <p className="dev-disclaimer">Development-only hot-seat controls · not multiplayer authentication · scoring and card play are not implemented.</p>
          </>
        )}
      </div>
    </main>
  );
}

function phaseLabel(phase: PlayerGameView["phase"]): string {
  switch (phase) {
    case "bidding": return "Bidding";
    case "adut-selected": return "Waiting for card play";
    case "round-complete": return "Complete";
    case "test-round-ended": return "Test ended";
  }
}

export default App;
