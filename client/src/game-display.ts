import type { Player, PlayerGameView } from "./game-api";

/** Keep the result of the tenth trick visible only while its server timer is pending. */
export function shouldRenderTrick(view: Pick<PlayerGameView, "phase" | "awaitingTrickAcknowledgement" | "currentTrick">): boolean {
  return view.phase === "playing" || view.phase === "trick-complete" ||
    (view.phase === "round-complete" && view.awaitingTrickAcknowledgement && view.currentTrick.cards.length > 0);
}

/** Render only cards that the server says are in the visible trick; empty tricks have no placeholders. */
export function getTrickCardsToDisplay(
  view: Pick<PlayerGameView, "phase" | "awaitingTrickAcknowledgement" | "currentTrick">,
): PlayerGameView["currentTrick"]["cards"] {
  return shouldRenderTrick(view) ? view.currentTrick.cards : [];
}

/** The upcard and deck are bidding-only table elements. */
export function shouldRenderBiddingCards(view: Pick<PlayerGameView, "phase">): boolean {
  return view.phase === "bidding";
}

export function shouldRenderRemainingPile(view: Pick<PlayerGameView, "phase" | "awaitingTrickAcknowledgement">): boolean {
  return view.phase === "playing" || view.phase === "trick-complete" ||
    (view.phase === "round-complete" && view.awaitingTrickAcknowledgement);
}

export function shouldRenderRoundSummary(view: Pick<PlayerGameView, "phase" | "awaitingTrickAcknowledgement">): boolean {
  return view.phase === "round-complete" && !view.awaitingTrickAcknowledgement;
}

/** Returns only cards newly accepted into the same server trick; reconnect snapshots are ignored. */
export function getNewTrickCardIds(
  previousKey: string | null,
  previousCardIds: ReadonlySet<string>,
  nextKey: string,
  nextCards: readonly { readonly card: { readonly id: string } }[],
): readonly string[] {
  if (previousKey !== nextKey) return [];
  return nextCards.filter(({ card }) => !previousCardIds.has(card.id)).map(({ card }) => card.id);
}

export function emptyHandStatus(phase: PlayerGameView["phase"], cardCount: number): string | null {
  if (cardCount !== 0) return null;
  if (phase === "bidding") return "Karte još nisu podijeljene";
  if (phase === "round-complete") return "Runda završena";
  if (phase === "test-round-ended") return "Probna runda završena";
  return null;
}

/** Contract status is projected into viewer-relative labels using the server's recorded caller. */
export function contractStatusMessage(contractSucceeded: boolean, caller: Player, viewer: Player): string {
  return contractSucceeded ? "Ugovor je ispunjen" : `Igrač ${caller === viewer ? "JA" : "TI"} je pao!`;
}
