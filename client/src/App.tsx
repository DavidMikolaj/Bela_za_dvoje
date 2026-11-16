import { useEffect, useState } from "react";
import { localGameApi, type LocalMatchSnapshot, type Player, type PlayerGameView } from "./game-api";
import { sortCardsForDisplay } from "./card-sorting";
import { PlayingCard } from "./components/PlayingCard";
import { getSuitIconAssetPath } from "./components/card-assets";
import "./App.css";

function playerName(player: Player): string {
  return player === "player1" ? "Igrač 1" : "Igrač 2";
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
    <section className={`player-area ${isCurrent ? "is-active" : ""}`} aria-label={`Karte igrača: ${playerName(player)}`}>
      <div className="player-heading">
        <div>
          <h2>{playerName(player)}</h2>
          <p>{isDealer ? "Djelitelj" : "Nedjelitelj"}</p>
        </div>
    {isCurrent && <span className="active-pill">Prikaz karata</span>}
        {((view.currentBidder === player && view.phase === "bidding") ||
          (view.currentPlayer === player && view.phase === "playing")) && <span className="turn-pill">Na potezu</span>}
      </div>
      <div className="hand-cards" aria-label={`Broj vidljivih karata: ${visibleCards.length}; skrivenih licem prema dolje: ${backCount}`}>
        {visibleCards.map((card) => (
          <PlayingCard
            key={card.id}
            card={card}
            onPlay={isViewer && isCurrent && view.phase === "playing" ? () => onPlayCard(card.id) : undefined}
            disabled={!canInteract || !legalCardIds.has(card.id)}
            legal={canInteract && legalCardIds.has(card.id)}
          />
        ))}
        {Array.from({ length: backCount }, (_, index) => <PlayingCard key={`back-${player}-${index}`} faceDown backLabel={`${playerName(player)} – karta ${index + 1}, licem prema dolje`} />)}
        {hand.cardCount === 0 && <span className="empty-hand">Karte nisu podijeljene</span>}
      </div>
      <p className="hand-caption">
        {visibleCards.length > 0
          ? `Prikazano: ${visibleCards.length}${backCount > 0 ? ` · skriveno: ${backCount}` : ""}`
          : `${hand.cardCount} karata okrenuto licem prema dolje`}
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
        if (active) setError(reason instanceof Error ? reason.message : "Nije moguće učitati lokalnu partiju.");
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
      setError(reason instanceof Error ? reason.message : "Radnja u igri nije uspjela.");
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
        <a className="brand" href="#top" aria-label="Bela za dvoje – početna stranica">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span><strong>Bela za dvoje</strong><small>LOKALNI STOL</small></span>
        </a>
        <div className="topbar-actions">
          {view && <span className="hotseat-tag"><span className="online-dot" /> Lokalna igra</span>}
          <button className="button button-subtle" onClick={() => void runAction(localGameApi.newMatch)} disabled={busy}>
            Nova partija
          </button>
        </div>
      </header>

      <div className="page-content" id="top">
        <section className="page-heading">
          <div>
            <p className="eyebrow">ZA DVOJE · MAĐARICE</p>
            <h1>Stol je vaš.</h1>
            <p className="intro">Lokalna igra za dvoje, od dijeljenja karata do bodovanja runde.</p>
          </div>
          {match && (
            <div className="round-chip">
              <span>RUNDA</span>
              <strong>{view!.roundNumber.toString().padStart(2, "0")}</strong>
            </div>
          )}
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => void runAction(localGameApi.getMatch)} disabled={busy}>Pokušaj ponovno</button>
          </div>
        )}

        {!match && !busy && (
          <section className="welcome-card">
            <div className="welcome-icon" aria-hidden="true">BA</div>
            <p className="eyebrow">SPREMNI ZA IGRU?</p>
            <h2>Započnite lokalnu partiju</h2>
            <p>Poslužitelj će promiješati i podijeliti karte. Preglednik prima samo prikaz aktivnog igrača.</p>
            <button className="button button-primary button-large" onClick={() => void runAction(localGameApi.newMatch)}>
              <span aria-hidden="true">＋</span> Nova partija
            </button>
            {busy && <p className="muted">Povezivanje s lokalnim poslužiteljem igre…</p>}
          </section>
        )}

        {match && view && (
          <>
            <section className="status-strip" aria-label="Stanje partije">
              <div className="status-item">
                <span className="status-icon">◷</span>
                <div><small>RUNDA</small><strong>{view.roundNumber}</strong></div>
              </div>
              <div className="status-item">
                <span className="status-icon">♟</span>
                <div><small>DJELITELJ</small><strong>{playerName(view.dealer)}</strong></div>
              </div>
              <div className="status-item">
                <span className="status-icon">↗</span>
                <div><small>NEDJELITELJ</small><strong>{playerName(view.nonDealer)}</strong></div>
              </div>
              <div className="status-item bidding-status">
                <span className="status-icon">◎</span>
                <div><small>{view.currentBidder ? "ODABIR ADUTA" : view.currentPlayer ? "IGRA KARTAMA" : "STANJE RUNDE"}</small>
                  <strong>{view.currentBidder ? playerName(view.currentBidder) : view.currentPlayer ? playerName(view.currentPlayer) : phaseLabel(view.phase)}</strong></div>
              </div>
            </section>

            {view.bidding.selectedSuit && <section className="adut-banner" aria-label={`Adut je ${view.bidding.selectedSuit}`}>
              <img src={getSuitIconAssetPath(view.bidding.selectedSuit)} alt="" />
              <div><small>ADUT OVE RUNDE</small><strong>{view.bidding.selectedSuit}</strong></div>
            </section>}

            <section className="scoreboard" aria-label="Rezultat partije">
              <div className="score-title"><span className="score-dot" /> REZULTAT PARTIJE <small>DO 1001</small></div>
              <div className="score-player"><span>Igrač 1</span><strong>{view.matchScores.player1}</strong></div>
              <span className="score-divider">—</span>
              <div className="score-player"><span>Igrač 2</span><strong>{view.matchScores.player2}</strong></div>
            </section>

            <section className="trick-scoreboard" aria-label="Rezultat runde">
              <span className="trick-score-title">REZULTAT RUNDE</span>
              <div><span>Igrač 1</span><strong>{view.tricksWon.player1} štihova · {view.trickPoints.player1} bod.</strong><small>{view.collectedCardCounts.player1} skupljenih karata</small></div>
              <span className="score-divider">—</span>
              <div><span>Igrač 2</span><strong>{view.tricksWon.player2} štihova · {view.trickPoints.player2} bod.</strong><small>{view.collectedCardCounts.player2} skupljenih karata</small></div>
              <span className="trick-progress">{view.tricksPlayed} / 10 štihova</span>
            </section>

            <section className="table" aria-label="Stol za Belu">
              <div className="felt-grain" aria-hidden="true" />
              <PlayerArea player="player2" view={view} activePlayer={match.activePlayer}
                onPlayCard={(cardId) => void runAction(() => localGameApi.playCard(cardId))} />

              <div className="table-center">
                <div className="table-rule" />
                <div className="center-cards">
                  <div className="deck-stack" aria-label={`Preostali špil: ${view.faceDownStackCount} karata`}>
                    <PlayingCard faceDown backLabel="Karta iz preostalog špila" />
                    <span className="deck-count">{view.faceDownStackCount}<small>KARATA</small></span>
                  </div>
                  <div className="upcard-wrap">
                    <span className="center-label">OTVORENA KARTA</span>
                    <PlayingCard key={view.faceUpCard.id} card={view.faceUpCard} />
                  </div>
                </div>
                {(view.phase === "playing" || view.currentTrick.cards.length > 0) && (
                  <div className="trick-display" aria-live="polite">
                    <div className="trick-display-heading">
                      <span>ŠTIH {view.currentTrick.number} <i>/ 10</i></span>
      {view.currentTrick.winner && <strong>{playerName(view.currentTrick.winner)} osvojio je štih</strong>}
                      {!view.currentTrick.winner && <strong>{view.currentPlayer
                        ? (view.currentTrick.cards.length === 0 ? "Odigrajte kartu" : `Čeka se ${playerName(view.currentPlayer)}`)
                        : "Probna igra završena je prije kraja štiha"}</strong>}
                    </div>
                    <div className="trick-cards">
                      {view.currentTrick.cards.map(({ player, card }) => (
                        <div className="played-card" key={`${view.currentTrick.number}-${player}`}>
                          <span>{playerName(player)}</span><PlayingCard card={card} />
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
                      <p className="eyebrow">ADUT · POTEZ {view.bidding.turn}</p>
                      <h2>{match.activePlayer === view.currentBidder
                        ? `${playerName(match.activePlayer)}, odaberite adut`
                        : `Čeka se ${playerName(view.currentBidder!)}`}</h2>
                      {allowedBids.length > 0 ? (
                        <div className="bid-actions">
                          {allowedBids.map((bid) => bid === null ? (
                            <button className="button button-pass" key="pass" onClick={() => void runAction(() => localGameApi.submitBid(null))} disabled={busy}>Prođi</button>
                          ) : (
                            <button className="button button-suit" key={bid} onClick={() => void runAction(() => localGameApi.submitBid(bid))} disabled={busy}>
                              Zovi <strong>{bid}</strong>
                            </button>
                          ))}
                        </div>
                      ) : <p className="small-note">Promijenite igrača kako biste predali potez za adut.</p>}
                    </>
                  )}
                  {view.phase === "playing" && (
                    <>
                      <p className="eyebrow">ŠTIH {view.currentTrick.number} OD 10 · ADUT {view.bidding.selectedSuit}</p>
                      <h2>{view.currentPlayer === match.activePlayer
                        ? `${playerName(match.activePlayer)}, odigrajte istaknutu kartu`
                        : `Čeka se ${playerName(view.currentPlayer!)}`}</h2>
                      <p className="small-note">{playerName(view.bidding.selectedBy!)} je odabrao adut · dopuštene karte su istaknute · Bela: {view.belaPoints[match.activePlayer]} bod.</p>
                    </>
                  )}
                  {view.phase === "trick-complete" && (
                    <>
                      <p className="eyebrow">ŠTIH {view.currentTrick.number} ZAVRŠEN</p>
                      <h2>{playerName(view.currentTrick.winner!)} osvojio je štih</h2>
                      <p className="small-note">Odigrane karte ostaju vidljive dok ne potvrdite ishod.</p>
                      <button className="button button-primary trick-ack-button" onClick={() => void runAction(localGameApi.acknowledgeTrick)} disabled={busy}>Potvrdi ishod štiha <span aria-hidden="true">→</span></button>
                    </>
                  )}
                  {view.phase === "test-round-ended" && (
                    <>
                      <p className="eyebrow">PROBNA RUNDA PREKINUTA</p>
                      <h2>Probna runda je završena</h2>
                      <p className="small-note">Runda nije odigrana do kraja i bodovi nisu dodijeljeni.</p>
                    </>
                  )}
                  {view.phase === "round-complete" && (
                    <>
                      <p className="eyebrow">RUNDA ZAVRŠENA · 10 ŠTIHOVA</p>
                      <h2>Runda je završena</h2>
                      <p className="small-note">Igrač 1: {view.tricksWon.player1} · Igrač 2: {view.tricksWon.player2} osvojenih štihova</p>
                      {view.roundScore && <RoundResult view={view} />}
                      {view.matchWinner && <h3 className="match-winner">{playerName(view.matchWinner)} pobjeđuje u partiji!</h3>}
                      {view.awaitingTrickAcknowledgement && <button className="button button-primary trick-ack-button" onClick={() => void runAction(localGameApi.acknowledgeTrick)} disabled={busy}>Potvrdi ishod zadnjeg štiha <span aria-hidden="true">→</span></button>}
                    </>
                  )}
                </div>
              </div>

              <PlayerArea player="player1" view={view} activePlayer={match.activePlayer}
                onPlayCard={(cardId) => void runAction(() => localGameApi.playCard(cardId))} />
            </section>

            <section className="controls-row" aria-label="Lokalne razvojne kontrole">
              <div className="handoff-copy">
                <span className="handoff-icon">⇄</span>
                <div><strong>Predaja poteza</strong><p>Predajte uređaj drugom igraču, zatim prikažite njegove karte.</p></div>
              </div>
              <div className="control-buttons">
                <button className="button button-subtle" onClick={() => void runAction(localGameApi.switchPlayer)} disabled={busy}>
                  Promijeni igrača <span aria-hidden="true">↗</span>
                </button>
                {isEnded && !view.matchWinner ? (
                  <button className="button button-primary" onClick={() => void runAction(localGameApi.startNextRound)} disabled={busy}>
                    Započni sljedeću rundu <span aria-hidden="true">→</span>
                  </button>
                ) : (view.phase === "bidding" || view.phase === "playing") ? (
                  <button className="button button-danger-quiet" onClick={() => void runAction(localGameApi.endTestRound)} disabled={busy}>
                    Završi probnu rundu
                  </button>
                ) : null}
              </div>
            </section>
            <DeclarationsPanel view={view} />
            <p className="dev-disclaimer">Razvojne kontrole za lokalno igranje · nisu prijava za mrežnu igru · najave prijava i ostala pravila još nisu dostupna.</p>
          </>
        )}
      </div>
    </main>
  );
}

function DeclarationsPanel({ view }: { readonly view: PlayerGameView }) {
  const isComplete = view.phase === "round-complete";
  const evaluated = view.bidding.selectedSuit !== null;
  const renderedPlayers: readonly Player[] = evaluated ? ["player1", "player2"] : [];
  return <section className="declarations-panel" aria-label="Prijave">
    <div><h2>Prijave i bela</h2><p>{!evaluated ? "Prijave se utvrđuju nakon odabira aduta i zamjene sedmice." : isComplete ? "Prikazane su prijave obaju igrača i njihova usporedba." : "Prijave obaju igrača su javne; ostale karte ostaju skrivene."}</p></div>
    {!evaluated && <p className="declarations-pending">Čeka se odabir aduta</p>}
    {renderedPlayers.map((player) => <div className="declarations-player" key={player}>
      <strong>{playerName(player)}</strong>
      <div className="declarations-list">
        {view.declarationsByPlayer[player].length ? view.declarationsByPlayer[player].map((declaration, index) => <span key={`${declaration.kind}-${index}`}>
          {declaration.kind === "sequence" ? "Niz" : `Četiri ${declaration.rank}`} · {declaration.cards.map(({ rank, suit }) => `${rank} ${suit}`).join(", ")} · {declaration.points} bod.
        </span>) : <span>Nema prijava</span>}
      </div>
    </div>)}
    {isComplete && view.declarationComparisonResult && <p className="small-note">
      Prijave: {view.declarationComparisonResult.winner ? `${playerName(view.declarationComparisonResult.winner)} osvaja ${view.declarationComparisonResult.pointsAwarded[view.declarationComparisonResult.winner]} bod.` : "Nema prijava koje donose bodove"}
      {` · Bela: ${view.belaPoints.player1}–${view.belaPoints.player2}`}
    </p>}
  </section>;
}

function RoundResult({ view }: { readonly view: PlayerGameView }) {
  const score = view.roundScore!;
  return <div className="round-result" aria-label="Pregled bodova runde">
    <h3>{score.contractSucceeded ? "Ugovor je ispunjen" : "Ugovor nije ispunjen"} · {playerName(score.caller)} je zvao adut</h3>
    <p>Štihovi: Igrač 1 {score.trickPoints.player1} · Igrač 2 {score.trickPoints.player2}</p>
    <p>Prijave: Igrač 1 {score.declarationPoints.player1} · Igrač 2 {score.declarationPoints.player2}</p>
    <p>Bela: Igrač 1 {score.belaPoints.player1} · Igrač 2 {score.belaPoints.player2}</p>
    <p>Zadnji štih: Igrač 1 {score.lastTrickBonus.player1} · Igrač 2 {score.lastTrickBonus.player2}</p>
    <p>Štiglja: Igrač 1 {score.stigljaBonus.player1} · Igrač 2 {score.stigljaBonus.player2}</p>
    <p>Ukupno u rundi: Igrač 1 {score.roundTotals.player1} · Igrač 2 {score.roundTotals.player2}</p>
    <p>Bodovi za partiju: Igrač 1 +{score.matchPointsAwarded.player1} · Igrač 2 +{score.matchPointsAwarded.player2}</p>
  </div>;
}

function phaseLabel(phase: PlayerGameView["phase"]): string {
  switch (phase) {
    case "bidding": return "Odabir aduta";
    case "playing": return "Igranje karata";
    case "trick-complete": return "Ishod štiha";
    case "round-complete": return "Završeno";
    case "test-round-ended": return "Probna runda prekinuta";
  }
}

export default App;
