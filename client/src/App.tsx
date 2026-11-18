import { useEffect, useState, type FormEvent } from "react";
import { localGameApi, type LocalMatchSnapshot, type Player, type PlayerGameView } from "./game-api";
import { sortCardsForDisplay } from "./card-sorting";
import { PlayingCard } from "./components/PlayingCard";
import { getSuitIconAssetPath } from "./components/card-assets";
import { createMultiplayerSocket, requestRoom, ROOM_SESSION_STORAGE_KEY, type MultiplayerSocket, type PublicRoomState, type RoomAck, type RoomCredential, type RoomPlayer, type RoomStartNotice } from "./multiplayer-api";
import "./App.css";

function otherPlayer(player: Player): Player {
  return player === "player1" ? "player2" : "player1";
}

function PlayerArea({
  player,
  view,
  onPlayCard,
}: {
  readonly player: Player;
  readonly view: PlayerGameView;
  readonly onPlayCard: (cardId: string) => void;
}) {
  const isViewer = view.viewer === player;
  const hand = view.hands[player];
  const visibleCards = sortCardsForDisplay(hand.cards);
  const backCount = Math.max(0, hand.cardCount - visibleCards.length);
  const isDealer = view.dealer === player;
  const isTurn = (view.currentBidder === player && view.phase === "bidding") ||
    (view.currentPlayer === player && view.phase === "playing");
  const canInteract = isViewer && isTurn && view.phase === "playing";
  const legalCardIds = new Set(view.legalCardIds);
  const role = isViewer ? "JA" : "TI";

  return (
    <section className={`player-area perspective-player ${isViewer ? "viewer-area" : "opponent-area"}`} aria-label={`${role}: ${isViewer ? "vaše karte" : "protivnikove karte"}`}>
      <div className="player-heading">
        <span className="player-avatar" aria-hidden="true">{isViewer ? "J" : "T"}</span>
        <div className="player-name-block">
          <h2>{isViewer ? "Vi" : "Protivnik"}</h2>
          <p>{role}{isDealer && <span className="dealer-badge" title="Djelitelj">D</span>}</p>
        </div>
        {isTurn && <span className="turn-pill">Na potezu</span>}
      </div>
      <div className="hand-cards" aria-label={`${role}: ${visibleCards.length} vidljivih karata, ${backCount} skrivenih`}>
        {visibleCards.map((card) => (
          <PlayingCard
            key={card.id}
            card={card}
            onPlay={canInteract ? () => onPlayCard(card.id) : undefined}
            disabled={!canInteract || !legalCardIds.has(card.id)}
            legal={canInteract && legalCardIds.has(card.id)}
          />
        ))}
        {Array.from({ length: backCount }, (_, index) => <PlayingCard key={`back-${role}-${index}`} faceDown backLabel={`${role}, karta ${index + 1} licem prema dolje`} />)}
        {hand.cardCount === 0 && <span className="empty-hand">Karte još nisu podijeljene</span>}
      </div>
      <p className="hand-caption">{isViewer ? (visibleCards.length ? `${visibleCards.length} karata u vašoj ruci` : "Vaša ruka") : `${hand.cardCount} karata protivnika`}</p>
    </section>
  );
}

function App() {
  const developmentMode = new URLSearchParams(window.location.search).get("dev") === "1";
  return developmentMode ? <LocalTestingApp /> : <MultiplayerApp />;
}

function MultiplayerApp() {
  const [socket, setSocket] = useState<MultiplayerSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [player, setPlayer] = useState<RoomPlayer | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const client = createMultiplayerSocket();
    let active = true;
    setSocket(client);

    const onConnect = () => {
      if (!active) return;
      setConnected(true);
      const sessionToken = window.localStorage.getItem(ROOM_SESSION_STORAGE_KEY);
      if (!sessionToken) return;
      void requestRoom<RoomCredential>((ack) => client.emit("room:resume", { sessionToken }, ack)).then((response) => {
        if (!active) return;
        if (response.ok) {
          setRoom(response.data.room);
          setPlayer(response.data.player);
          setError(null);
        } else {
          window.localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
          setRoom(null);
          setPlayer(null);
          setError(response.error.message);
        }
      });
    };
    const onDisconnect = () => { if (active) setConnected(false); };
    const onConnectError = () => {
      if (active) {
        setConnected(false);
        setError("Nije moguće povezati se s poslužiteljem. Veza će se pokušati uspostaviti ponovno.");
      }
    };
    const onRoomState = (state: PublicRoomState | { readonly roomCode: string; readonly closed: true; readonly reason: "creator-left" }) => {
      if (!active) return;
      if ("closed" in state) {
        window.localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
        setRoom(null);
        setPlayer(null);
        setNotice("Kreator je zatvorio sobu. Možete stvoriti novu sobu ili se pridružiti drugoj.");
        return;
      }
      setRoom(state);
    };
    const onRoomStarted = ({ roomCode }: { readonly roomCode: string }) => {
      if (!active) return;
      setRoom((current) => current?.code === roomCode ? { ...current, status: "started" } : current);
    };

    client.on("connect", onConnect);
    client.on("disconnect", onDisconnect);
    client.on("connect_error", onConnectError);
    client.on("room:state", onRoomState);
    client.on("room:started", onRoomStarted);
    return () => {
      active = false;
      client.off("connect", onConnect);
      client.off("disconnect", onDisconnect);
      client.off("connect_error", onConnectError);
      client.off("room:state", onRoomState);
      client.off("room:started", onRoomStarted);
      client.disconnect();
    };
  }, []);

  const request = async <T,>(send: (ack: (response: RoomAck<T>) => void) => void): Promise<T> => {
    if (!socket?.connected) throw new Error("Veza s poslužiteljem nije uspostavljena.");
    const response = await requestRoom(send);
    if (!response.ok) throw new Error(response.error.message);
    return response.data;
  };

  const perform = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Radnja u sobi nije uspjela."); }
    finally { setBusy(false); }
  };

  const acceptCredential = (credential: RoomCredential) => {
    setRoom(credential.room);
    setPlayer(credential.player);
    setNotice(null);
    try { window.localStorage.setItem(ROOM_SESSION_STORAGE_KEY, credential.sessionToken); }
    catch { setError("Soba je otvorena, ali preglednik ne može spremiti podatke za ponovno povezivanje."); }
  };

  const createRoom = () => perform(async () => {
    const credential = await request<RoomCredential>((ack) => socket!.emit("room:create", ack));
    acceptCredential(credential);
  });

  const joinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(async () => {
      const credential = await request<RoomCredential>((ack) => socket!.emit("room:join", { roomCode: roomCodeInput }, ack));
      acceptCredential(credential);
    });
  };

  const leaveRoom = () => perform(async () => {
    await request((ack) => socket!.emit("room:leave", ack));
    window.localStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    setRoom(null);
    setPlayer(null);
    setNotice("Napustili ste sobu.");
  });

  const startMatch = () => perform(async () => {
    const started = await request<RoomStartNotice & { readonly room: PublicRoomState }>((ack) => socket!.emit("room:start", ack));
    setRoom(started.room);
  });

  const copyRoomCode = () => {
    if (!room) return;
    if (!navigator.clipboard?.writeText) {
      setError("Kopiranje nije dostupno. Označite oznaku sobe i kopirajte je ručno.");
      return;
    }
    void navigator.clipboard.writeText(room.code)
      .then(() => setNotice("Oznaka sobe kopirana je u međuspremnik."))
      .catch(() => setError("Nije moguće kopirati oznaku. Označite je i kopirajte ručno."));
  };

  const startEnabled = connected && !busy && room?.status === "ready";

  return (
    <main className="app-shell multiplayer-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bela za dvoje — početna stranica">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span><strong>Bela za dvoje</strong><small>MAĐARICE · ZA DVOJE</small></span>
        </a>
        <div className="topbar-actions"><span className={`connection-status ${connected ? "is-connected" : ""}`}><span className="online-dot" />{connected ? "Povezano" : "Povezivanje…"}</span></div>
      </header>

      <div className="page-content multiplayer-content" id="top">
        {!room ? (
          <section className="multiplayer-home">
            <div className="welcome-icon" aria-hidden="true">BA</div>
            <p className="eyebrow">HRVATSKA BELA · ONLINE</p>
            <h1>Zaigrajte Belu udvoje</h1>
            <p className="multiplayer-intro">Stvorite privatnu sobu i pozovite drugog igrača oznakom sobe.</p>
            <div className="multiplayer-options">
              <article className="multiplayer-option">
                <span className="option-icon" aria-hidden="true">＋</span>
                <h2>Kreiraj sobu</h2>
                <p>Otvorite novu privatnu sobu kao Igrač 1.</p>
                <button className="button button-primary button-large" type="button" onClick={() => void createRoom()} disabled={!connected || busy}>Kreiraj sobu</button>
              </article>
              <article className="multiplayer-option">
                <span className="option-icon" aria-hidden="true">↗</span>
                <h2>Pridruži se sobi</h2>
                <p>Unesite oznaku koju vam je poslao drugi igrač.</p>
                <form className="join-room-form" onSubmit={joinRoom}>
                  <label htmlFor="room-code">Oznaka sobe</label>
                  <input id="room-code" name="roomCode" autoComplete="off" maxLength={12} value={roomCodeInput}
                    onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} placeholder="Npr. K7M4XP" disabled={!connected || busy} />
                  <button className="button button-subtle button-large" type="submit" disabled={!connected || busy || !roomCodeInput.trim()}>Pridruži se sobi</button>
                </form>
              </article>
            </div>
            <p className="multiplayer-footnote">Sobe su privremene i zatvaraju se ponovnim pokretanjem poslužitelja.</p>
          </section>
        ) : (
          <section className="room-lobby">
            <p className="eyebrow">PRIVATNA SOBA · {room.status === "started" ? "PARTIJA ZAPOČELA" : "ČEKAONICA"}</p>
            <h1>{room.status === "started" ? "Partija je započela" : "Vaša soba"}</h1>
            <div className="room-code-card">
              <span>OZNAKA SOBE</span><strong aria-label={`Oznaka sobe ${room.code}`}>{room.code}</strong>
              <button className="button button-subtle" type="button" onClick={() => void copyRoomCode()}>Kopiraj oznaku</button>
            </div>
            <div className="room-player-slots">
              {(["player1", "player2"] as const).map((seat) => {
                const slot = room.players[seat];
                return <article className={`room-player-slot ${slot.connected ? "slot-connected" : ""}`} key={seat}>
                  <span className="player-avatar" aria-hidden="true">{seat === "player1" ? "1" : "2"}</span>
                  <div><strong>Igrač {seat === "player1" ? "1" : "2"}{player === seat ? " · Vi" : ""}</strong>
                    <p>{seat === "player1" ? "Kreator sobe" : slot.assigned ? "Pridruženi igrač" : "Slobodno mjesto"}</p></div>
                  <span className={`room-player-status ${slot.connected ? "" : "is-offline"}`}><i />{slot.connected ? "Povezan" : slot.assigned ? "Odspojen" : "Čeka se"}</span>
                </article>;
              })}
            </div>
            <div className="room-lobby-message" role="status">
              {room.status === "started" ? "Mrežna igra bit će dostupna u sljedećoj razvojnoj fazi." : room.status === "ready" ? "Oba su igrača povezana. Kreator može započeti partiju." : "Čeka se da se drugi igrač pridruži sobi."}
            </div>
            {room.status === "started" ? <div className="multiplayer-placeholder"><strong>Partija je spremna</strong><p>Ovdje će se prikazati mrežni stol u sljedećoj fazi.</p></div> : null}
            {error && <p className="multiplayer-error" role="alert">{error}</p>}
            {notice && <p className="multiplayer-notice" role="status">{notice}</p>}
            <div className="room-lobby-actions">
              {player === "player1" && <button className="button button-primary button-large" type="button" onClick={() => void startMatch()} disabled={!startEnabled}>Započni partiju</button>}
              <button className="button button-subtle button-large" type="button" onClick={() => void leaveRoom()} disabled={busy || !connected}>Napusti sobu</button>
            </div>
          </section>
        )}
        {!room && error && <p className="multiplayer-error" role="alert">{error}</p>}
        {!room && notice && <p className="multiplayer-notice" role="status">{notice}</p>}
      </div>
    </main>
  );
}

function LocalTestingApp() {
  const [snapshot, setSnapshot] = useState<LocalMatchSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zvanjaPlayer, setZvanjaPlayer] = useState<Player | null>(null);
  const [pendingBelaCardId, setPendingBelaCardId] = useState<string | null>(null);
  const developmentMode = true;

  useEffect(() => {
    let active = true;
    localGameApi.getMatch()
      .then((match) => { if (active) setSnapshot(match); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Nije moguće učitati partiju.");
      });
    return () => { active = false; };
  }, []);

  const match = snapshot?.matchExists ? snapshot : null;
  const view = match?.view ?? null;

  useEffect(() => {
    if (!match || !view?.awaitingTrickAcknowledgement || match.trickTransitionAt === null) return;
    let active = true;
    const timer = window.setTimeout(() => {
      // Hide the old hand while the server changes the active player after the result display.
      setSnapshot((current) => {
        if (!current?.matchExists) return current;
        const player = current.view.viewer;
        const oldHand = current.view.hands[player];
        const hiddenHand = { cards: [], cardCount: oldHand.cardCount, hiddenCardCount: oldHand.cardCount };
        return {
          ...current,
          view: {
            ...current.view,
            hands: { ...current.view.hands, [player]: hiddenHand },
            legalCardIds: [],
          },
        };
      });
      localGameApi.getMatch().then((latest) => {
        if (!active) return;
        setSnapshot(latest);
        if (latest.matchExists && latest.view.awaitingTrickAcknowledgement && latest.trickTransitionAt !== null && latest.trickTransitionAt <= Date.now()) {
          window.setTimeout(() => { void localGameApi.getMatch().then((retry) => { if (active) setSnapshot(retry); }); }, 100);
        }
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Nije moguće osvježiti stanje štiha.");
      });
    }, Math.max(0, match.trickTransitionAt - Date.now() + 60));
    return () => { active = false; window.clearTimeout(timer); };
  }, [match?.trickTransitionAt, view?.awaitingTrickAcknowledgement]);

  const runAction = async (action: () => Promise<LocalMatchSnapshot>) => {
    setError(null);
    // A hot-seat handoff never leaves the previous private hand on screen during the request.
    setSnapshot(null);
    setBusy(true);
    try {
      setSnapshot(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Radnja u igri nije uspjela.");
      try { setSnapshot(await localGameApi.getMatch()); } catch { /* Keep private cards hidden if refresh fails. */ }
    } finally {
      setBusy(false);
    }
  };

  const isEnded = view?.phase === "test-round-ended" ||
    (view?.phase === "round-complete" && !view.awaitingTrickAcknowledgement);
  const allowedBids = view?.allowedBids ?? [];

  return (
    <main className={`app-shell ${match ? "has-match" : ""} ${view?.phase === "round-complete" ? "round-finished" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bela za dvoje – početna stranica">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span><strong>Bela za dvoje</strong><small>MAĐARICE · ZA DVOJE</small></span>
        </a>
        <div className="topbar-actions">
          {match && <span className="hotseat-tag"><span className="online-dot" /> Lokalni stol</span>}
          <button className="button button-subtle" onClick={() => void runAction(localGameApi.newMatch)} disabled={busy}>Nova partija</button>
        </div>
      </header>

      <div className={`page-content ${match ? "game-screen" : ""}`} id="top">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={() => void runAction(localGameApi.getMatch)} disabled={busy}>Pokušaj ponovno</button></div>}

        {!match && !busy && (
          <section className="welcome-card">
            <div className="welcome-icon" aria-hidden="true">BA</div>
            <p className="eyebrow">HRVATSKA BELA · MAĐARICE</p>
            <h1>Vaš stol je spreman.</h1>
            <p>Poslužitelj će promiješati i podijeliti karte. Vaš preglednik prikazuje samo vašu ruku.</p>
            <button className="button button-primary button-large" onClick={() => void runAction(localGameApi.newMatch)} disabled={busy}>Nova partija <span aria-hidden="true">→</span></button>
          </section>
        )}

        {match && view && (
          <>
            <section className="match-heading">
              <div><p className="eyebrow">PARTIJA · DO 1001</p><h1>Runda {view.roundNumber}</h1></div>
              {view.bidding.selectedSuit && <div className="adut-banner" aria-label={`Adut je ${view.bidding.selectedSuit}`}>
                <img src={getSuitIconAssetPath(view.bidding.selectedSuit)} alt="" /><div><small>ADUT</small><strong>{view.bidding.selectedSuit}</strong></div>
              </div>}
            </section>

            <section className="scoreboard perspective-scoreboard" aria-label="Rezultat partije i runde">
              {([view.viewer, otherPlayer(view.viewer)] as const).map((player) => {
                const self = player === view.viewer;
                const award = view.zvanjaPointsAwarded[player];
                return <div className={`score-perspective ${self ? "score-self" : "score-opponent"}`} key={player}>
                  <div className="score-player-label"><strong>{self ? "JA" : "TI"}</strong>{view.dealer === player && <span className="dealer-badge" title="Djelitelj">D</span>}</div>
                  <div className="score-numbers"><span className="score-total">{view.matchScores[player]}<small>UKUPNO</small></span><span className="score-round">{view.trickPoints[player]}<small>RUNDA</small></span>
                    <button className="declaration-bonus" type="button" onClick={() => setZvanjaPlayer(player)} aria-haspopup="dialog" aria-label={`Prikaži zvanja za ${self ? "JA" : "TI"}: ukupno ${award} bodova`}>+{award} zvanja</button>
                  </div>
                </div>;
              })}
            </section>

            <section className="table" aria-label="Stol za Belu">
              <div className="felt-grain" aria-hidden="true" />
              <PlayerArea player={otherPlayer(view.viewer)} view={view} onPlayCard={() => undefined} />

              <div className="table-center">
                <div className="table-rule" />
                <div className="center-cards">
                  <div className="deck-stack" aria-label={`Preostali špil: ${view.faceDownStackCount} karata`}>
                    <PlayingCard faceDown backLabel="Preostali špil, licem prema dolje" />
                    <span className="deck-count">{view.faceDownStackCount}<small>KARATA</small></span>
                  </div>
                  <div className="upcard-wrap"><span className="center-label">OTVORENA KARTA</span><PlayingCard key={view.faceUpCard.id} card={view.faceUpCard} /></div>
                </div>

                {(view.phase === "playing" || view.currentTrick.cards.length > 0) && <div className="trick-display" aria-live="polite">
                  <div className="trick-display-heading"><span>ŠTIH {view.currentTrick.number} <i>/ 10</i></span>
                    <strong>{view.currentTrick.winner ? `${view.currentTrick.winner === view.viewer ? "Vi" : "Protivnik"} osvaja štih` : view.currentPlayer ? (view.currentTrick.cards.length === 0 ? "Odaberite kartu" : "Čeka se druga karta") : "Runda je završena"}</strong>
                  </div>
                  <div className="trick-cards">
                    {view.currentTrick.cards.map(({ player, card }) => <div className={`played-card ${view.currentTrick.winner === player ? "trick-winner-card" : ""}`} key={`${view.currentTrick.number}-${player}`}>
                      <span>{player === view.viewer ? "JA" : "TI"}</span><PlayingCard card={card} />
                    </div>)}
                    {Array.from({ length: 2 - view.currentTrick.cards.length }, (_, index) => <div className="played-card" key={`waiting-${index}`}><span>—</span><div className="card-slot">·</div></div>)}
                  </div>
                </div>}
                <div className="table-rule" />
                <div className="bidding-panel" aria-live="polite">
                  {view.phase === "bidding" && <>
                    <p className="eyebrow">ODABIR ADUTA · POTEZ {view.bidding.turn}</p>
                    <h2>{match.activePlayer === view.currentBidder ? "Odaberite adut" : `Čeka se ${view.currentBidder === view.viewer ? "vaš" : "protivnikov"} odabir`}</h2>
                    {allowedBids.length > 0 ? <div className="bid-actions">{allowedBids.map((bid) => bid === null
                      ? <button className="button button-pass" key="pass" onClick={() => void runAction(() => localGameApi.submitBid(null))} disabled={busy}>Dalje</button>
                      : <button className="button button-suit" key={bid} onClick={() => void runAction(() => localGameApi.submitBid(bid))} disabled={busy}>Zovi <strong>{bid}</strong></button>)}</div>
                      : <p className="small-note">U razvojnom načinu predajte potez drugom igraču.</p>}
                  </>}
                  {view.phase === "playing" && <>
                    <p className="eyebrow">ŠTIH {view.currentTrick.number} OD 10 · ADUT {view.bidding.selectedSuit}</p>
                    <h2>{view.currentPlayer === view.viewer ? "Vaš je potez" : "Protivnik je na potezu"}</h2>
                    <p className="small-note">Istaknute karte su dopušteni potezi.{view.zvanjaPointsAwarded[view.viewer] > 0 || view.zvanjaPointsAwarded[otherPlayer(view.viewer)] > 0
                      ? ` Osvojena zvanja: ${view.zvanjaPointsAwarded[view.viewer] > 0 ? `JA +${view.zvanjaPointsAwarded[view.viewer]}` : `TI +${view.zvanjaPointsAwarded[otherPlayer(view.viewer)]}`} boda.`
                      : ""}</p>
                  </>}
                  {view.phase === "trick-complete" && <>
                    <p className="eyebrow">ŠTIH {view.currentTrick.number} ZAVRŠEN</p><h2>{view.currentTrick.winner === view.viewer ? "Osvojili ste štih" : "Protivnik osvaja štih"}</h2>
                    <p className="small-note">Sljedeći štih počinje automatski.</p>
                  </>}
                  {view.phase === "test-round-ended" && <><p className="eyebrow">RAZVOJNA RUNDA PREKINUTA</p><h2>Runda nije odigrana do kraja</h2></>}
                  {view.phase === "round-complete" && <>
                    <p className="eyebrow">RUNDA ZAVRŠENA · 10 ŠTIHOVA</p><h2>Runda je završena</h2>
                    <p className="small-note">JA: {view.tricksWon[view.viewer]} štiha · TI: {view.tricksWon[otherPlayer(view.viewer)]} štiha</p>
                    {view.roundScore && <RoundResult view={view} />}
                    {view.matchWinner && <h3 className="match-winner">{view.matchWinner === view.viewer ? "Pobijedili ste" : "Protivnik je pobijedio"} u partiji!</h3>}
                    {view.awaitingTrickAcknowledgement && <p className="small-note">Prikaz zadnjeg štiha završava automatski.</p>}
                  </>}
                </div>
              </div>

              <PlayerArea player={view.viewer} view={view} onPlayCard={(cardId) => {
                if (view.belaAnnouncementCardIds.includes(cardId)) setPendingBelaCardId(cardId);
                else void runAction(() => localGameApi.playCard(cardId, false));
              }} />
            </section>
            {zvanjaPlayer && <ZvanjaDialog view={view} player={zvanjaPlayer} onClose={() => setZvanjaPlayer(null)} />}
            {pendingBelaCardId && view.hands[view.viewer].cards.find(({ id }) => id === pendingBelaCardId) && <BelaCallDialog
              card={view.hands[view.viewer].cards.find(({ id }) => id === pendingBelaCardId)!}
              onChoose={(callBela) => {
                const cardId = pendingBelaCardId;
                setPendingBelaCardId(null);
                void runAction(() => localGameApi.playCard(cardId, callBela));
              }}
              onCancel={() => setPendingBelaCardId(null)}
            />}

            <section className={`controls-row ${developmentMode ? "dev-controls" : ""}`} aria-label={developmentMode ? "Razvojne kontrole" : "Kontrole partije"}>
              <div className="handoff-copy"><span className="handoff-icon" aria-hidden="true">{view.currentPlayer === view.viewer ? "●" : "◉"}</span><div><strong>{view.currentPlayer === view.viewer ? "Vaš red za igru" : view.phase === "bidding" && view.currentBidder === view.viewer ? "Vaš red za adut" : "Čeka se protivnik"}</strong><p>{view.phase === "playing" ? "Pravila poteza provjerava poslužitelj." : phaseLabel(view.phase)}</p></div></div>
              <div className="control-buttons">
                {developmentMode && view.phase !== "trick-complete" && !view.awaitingTrickAcknowledgement && <button className="button button-subtle" onClick={() => void runAction(localGameApi.switchPlayer)} disabled={busy}>Predaj uređaj</button>}
                {isEnded && !view.matchWinner && <button className="button button-primary" onClick={() => void runAction(localGameApi.startNextRound)} disabled={busy}>Započni sljedeću rundu <span aria-hidden="true">→</span></button>}
                {developmentMode && (view.phase === "bidding" || view.phase === "playing") && <button className="button button-danger-quiet" onClick={() => void runAction(localGameApi.endTestRound)} disabled={busy}>Prekini probnu rundu</button>}
              </div>
            </section>
            {developmentMode && <p className="dev-disclaimer">Lokalni hot-seat način razvoja · pristup putem ?dev=1</p>}
          </>
        )}
      </div>
    </main>
  );
}

function RoundResult({ view }: { readonly view: PlayerGameView }) {
  const score = view.roundScore!;
  const awardedPlayers = ([view.viewer, otherPlayer(view.viewer)] as const)
    .filter((player) => view.zvanjaPointsAwarded[player] > 0);
  return <div className="round-result" aria-label="Pregled bodova runde">
    <h3>{score.contractSucceeded ? "Ugovor je ispunjen" : "Ugovor nije ispunjen"}</h3>
    <p>Štihovi · JA {score.trickPoints[view.viewer]} · TI {score.trickPoints[otherPlayer(view.viewer)]}</p>
    <p>Zvanja zarađena · {awardedPlayers.length ? awardedPlayers.map((player) => `${player === view.viewer ? "JA" : "TI"} +${view.zvanjaPointsAwarded[player]}`).join(" · ") : "bez osvojenih zvanja"}</p>
    <p>Zadnji štih · JA {score.lastTrickBonus[view.viewer]} · TI {score.lastTrickBonus[otherPlayer(view.viewer)]}</p>
    <p>Štiglja · JA {score.stigljaBonus[view.viewer]} · TI {score.stigljaBonus[otherPlayer(view.viewer)]}</p>
    <p>{score.contractSucceeded ? "Ukupno u rundi" : "Zbroj runde prije prijenosa"} · JA {score.roundTotals[view.viewer]} · TI {score.roundTotals[otherPlayer(view.viewer)]}</p>
    <p className="match-points-awarded">Bodovi dodijeljeni za partiju · JA +{score.matchPointsAwarded[view.viewer]} · TI +{score.matchPointsAwarded[otherPlayer(view.viewer)]}</p>
    {!score.contractSucceeded && <p className="contract-failure-note">Ugovor nije ispunjen. Protivnik preuzima sve bodove runde, uključujući zvanja i Belu.</p>}
    <div className="round-zvanja-details"><h4>Osvojena zvanja u ovoj rundi</h4>
      {([view.viewer, otherPlayer(view.viewer)] as const).map((player) => <ZvanjaList key={player} view={view} player={player} />)}
      {awardedPlayers.length === 0 && <p>Nema osvojenih zvanja.</p>}
    </div>
  </div>;
}

function ZvanjaDialog({ view, player, onClose }: { readonly view: PlayerGameView; readonly player: Player; readonly onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const role = player === view.viewer ? "JA" : "TI";
  return <div className="zvanja-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="zvanja-dialog" role="dialog" aria-modal="true" aria-labelledby="zvanja-dialog-title">
      <button className="zvanja-close" type="button" onClick={onClose} aria-label="Zatvori zvanja">×</button>
      <p className="eyebrow">RUNDA {view.roundNumber} · {role}</p>
      <h2 id="zvanja-dialog-title">Osvojena zvanja</h2>
      <ZvanjaList view={view} player={player} />
      {!view.awardedZvanja[player].length && <p className="zvanja-empty">Još nema osvojenih zvanja.</p>}
    </section>
  </div>;
}

function ZvanjaList({ view, player }: { readonly view: PlayerGameView; readonly player: Player }) {
  const items = view.awardedZvanja[player];
  const role = player === view.viewer ? "JA" : "TI";
  if (!items.length) return null;
  return <div className="zvanja-list" aria-label={`${role}: osvojena zvanja`}>
    {items.map((item) => <article className="zvanja-item" key={item.id}>
      <div className="zvanja-item-heading"><strong>{item.name}</strong><span>+{item.points}</span></div>
      <p>{role} je osvojio/la · {item.kind === "bela" ? `adut ${view.bidding.selectedSuit}` : "zvanje"}</p>
      <div className="zvanja-cards" aria-label={`Karte za ${item.name}`}>
        {item.cards.map((card) => <PlayingCard key={card.id} card={card} />)}
      </div>
    </article>)}
  </div>;
}

function BelaCallDialog({ card, onChoose, onCancel }: { readonly card: PlayerGameView["hands"][Player]["cards"][number]; readonly onChoose: (callBela: boolean) => void; readonly onCancel: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return <div className="zvanja-overlay bela-call-overlay">
    <section className="zvanja-dialog bela-call-dialog" role="dialog" aria-modal="true" aria-labelledby="bela-call-title">
      <p className="eyebrow">ODIGRAVANJE ADUTSKOG KRALJA ILI DAME</p>
      <h2 id="bela-call-title">Želite li zvati Belu?</h2>
      <div className="bela-call-card"><PlayingCard card={card} /></div>
      <p className="small-note">Belu možete zvati uz kralja ili damu aduta. Bodovi se dodjeljuju kada odigrate oba.</p>
      <div className="bela-call-actions">
        <button className="button button-primary" type="button" onClick={() => onChoose(true)}>Zovi Belu (+20)</button>
        <button className="button button-subtle" type="button" onClick={() => onChoose(false)}>Odigraj bez zvanja</button>
      </div>
      <button className="bela-call-cancel" type="button" onClick={onCancel}>Odustani i odaberi drugu kartu</button>
    </section>
  </div>;
}

function phaseLabel(phase: PlayerGameView["phase"]): string {
  switch (phase) {
    case "bidding": return "Odabir aduta";
    case "playing": return "Igranje karata";
    case "trick-complete": return "Prikaz ishoda štiha";
    case "round-complete": return "Runda završena";
    case "test-round-ended": return "Probna runda prekinuta";
  }
}

export default App;
