import { describe, expect, it } from "vitest";
import { emptyHandStatus, shouldRenderBiddingCards, shouldRenderRemainingPile, shouldRenderRoundSummary, shouldRenderTrick } from "../src/game-display";

function view(phase: "bidding" | "playing" | "trick-complete" | "round-complete" | "test-round-ended", awaitingTrickAcknowledgement = false) {
  return {
    phase,
    awaitingTrickAcknowledgement,
    currentTrick: { cards: [{ player: "player1" as const, card: { id: "final-card", suit: "srce" as const, rank: "A" as const } }] },
  };
}

describe("game table display phases", () => {
  it("only renders the deck and face-up card during bidding", () => {
    expect(shouldRenderBiddingCards(view("bidding"))).toBe(true);
    expect(shouldRenderBiddingCards(view("playing"))).toBe(false);
    expect(shouldRenderBiddingCards(view("trick-complete", true))).toBe(false);
    expect(shouldRenderBiddingCards(view("round-complete"))).toBe(false);
    expect(shouldRenderRemainingPile(view("playing"))).toBe(true);
    expect(shouldRenderRemainingPile(view("trick-complete", true))).toBe(true);
    expect(shouldRenderRemainingPile(view("round-complete", true))).toBe(true);
    expect(shouldRenderRemainingPile(view("round-complete", false))).toBe(false);
  });

  it("keeps a completed tenth trick for its timer, then removes it from the table", () => {
    expect(shouldRenderTrick(view("round-complete", true))).toBe(true);
    const acknowledged = view("round-complete", false);
    expect(acknowledged.currentTrick.cards).toHaveLength(1); // Engine history remains available.
    expect(shouldRenderTrick(acknowledged)).toBe(false);
    expect(shouldRenderRoundSummary(acknowledged)).toBe(true);
  });

  it("shows active and transitioning tricks but not a development-ended table", () => {
    expect(shouldRenderTrick(view("playing"))).toBe(true);
    expect(shouldRenderTrick(view("trick-complete", true))).toBe(true);
    expect(shouldRenderTrick(view("test-round-ended"))).toBe(false);
    expect(shouldRenderRoundSummary(view("round-complete", true))).toBe(false);
  });

  it("uses hand status text that matches the current phase", () => {
    expect(emptyHandStatus("bidding", 0)).toBe("Karte još nisu podijeljene");
    expect(emptyHandStatus("playing", 0)).toBeNull();
    expect(emptyHandStatus("trick-complete", 0)).toBeNull();
    expect(emptyHandStatus("round-complete", 0)).toBe("Runda završena");
    expect(emptyHandStatus("playing", 2)).toBeNull();
  });
});
