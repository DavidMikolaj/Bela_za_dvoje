import type { PlayerGameView } from "./game-api";

/** Keep the result of the tenth trick visible only while its server timer is pending. */
export function shouldRenderTrick(view: Pick<PlayerGameView, "phase" | "awaitingTrickAcknowledgement" | "currentTrick">): boolean {
  return view.phase === "playing" || view.phase === "trick-complete" ||
    (view.phase === "round-complete" && view.awaitingTrickAcknowledgement && view.currentTrick.cards.length > 0);
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

export function emptyHandStatus(phase: PlayerGameView["phase"], cardCount: number): string | null {
  if (cardCount !== 0) return null;
  if (phase === "bidding") return "Karte još nisu podijeljene";
  if (phase === "round-complete") return "Runda završena";
  if (phase === "test-round-ended") return "Probna runda završena";
  return null;
}
