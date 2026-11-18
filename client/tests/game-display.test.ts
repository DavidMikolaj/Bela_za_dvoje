import { describe, expect, it } from "vitest";
import { contractStatusMessage, emptyHandStatus, getNewTrickCardIds, getTrickCardsToDisplay, shouldRenderBiddingCards, shouldRenderRemainingPile, shouldRenderRoundSummary, shouldRenderTrick } from "../src/game-display";

function view(phase: "bidding" | "playing" | "trick-complete" | "round-complete" | "test-round-ended", awaitingTrickAcknowledgement = false, cardCount = 1) {
  return {
    phase,
    awaitingTrickAcknowledgement,
    currentTrick: { cards: Array.from({ length: cardCount }, (_, index) => ({ player: (index === 0 ? "player1" : "player2") as "player1" | "player2", card: { id: `trick-card-${index}`, suit: "srce" as const, rank: "A" as const } })) },
  };
}

describe("game table display phases", () => {
  it("uses caller identity relative to the viewer for a failed contract", () => {
    expect(contractStatusMessage(false, "player1", "player1")).toBe("Igrač JA je pao!");
    expect(contractStatusMessage(false, "player2", "player1")).toBe("Igrač TI je pao!");
    expect(contractStatusMessage(false, "player1", "player2")).toBe("Igrač TI je pao!");
    expect(contractStatusMessage(false, "player2", "player2")).toBe("Igrač JA je pao!");
    expect(contractStatusMessage(true, "player1", "player2")).toBe("Ugovor je ispunjen");
  });

  it("starts a flight only for newly accepted cards in the current trick", () => {
    const before = new Set(["first"]);
    expect(getNewTrickCardIds("4:2", before, "4:2", [
      { card: { id: "first" } }, { card: { id: "second" } },
    ])).toEqual(["second"]);
    expect(getNewTrickCardIds("4:2", new Set(["first", "second"]), "4:2", [
      { card: { id: "first" } }, { card: { id: "second" } },
    ])).toEqual([]); // Identical reconnect snapshot does not replay.
    expect(getNewTrickCardIds("4:2", before, "4:3", [{ card: { id: "first" } }])).toEqual([]);
  });

  it("shows zero, one, or two real trick cards without synthesizing empty slots", () => {
    expect(getTrickCardsToDisplay(view("playing", false, 0))).toHaveLength(0);
    expect(getTrickCardsToDisplay(view("playing", false, 1)).map(({ card }) => card.id)).toEqual(["trick-card-0"]);
    expect(getTrickCardsToDisplay(view("trick-complete", true, 2)).map(({ card }) => card.id)).toEqual(["trick-card-0", "trick-card-1"]);
    expect(getTrickCardsToDisplay(view("round-complete", false, 2))).toHaveLength(0);
  });

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
