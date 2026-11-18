import { describe, expect, it } from "vitest";
import type { PlayerGameView } from "../src/game-api";
import { getNewDeclarationNotices } from "../src/declaration-notices";

function view(): PlayerGameView {
  return {
    roundNumber: 3,
    awardedZvanja: {
      player1: [
        { id: "ordinary:1:2:3", player: "player1", name: "Terca", points: 20, kind: "ordinary", cards: [
          { id: "srce-7", suit: "srce", rank: "7" }, { id: "srce-8", suit: "srce", rank: "8" }, { id: "srce-9", suit: "srce", rank: "9" },
        ] },
        { id: "bela:king:queen", player: "player1", name: "Bela", points: 20, kind: "bela", cards: [
          { id: "zelje-K", suit: "zelje", rank: "K" }, { id: "zelje-Q", suit: "zelje", rank: "Q" },
        ] },
      ],
      player2: [],
    },
    belaAnnouncements: [{
      id: "bela:zelje-K:zelje-Q", player: "player1", pointsAwarded: false,
      cards: [
        { id: "zelje-K", suit: "zelje", rank: "K" },
        { id: "zelje-Q", suit: "zelje", rank: "Q" },
      ],
    }],
  } as PlayerGameView;
}

describe("awarded declaration notifications", () => {
  it("creates an ordinary notice and an immediate Bela announcement with its King and Queen", () => {
    const notices = getNewDeclarationNotices(view(), new Set());
    expect(notices.map(({ kind, player }) => ({ kind, player }))).toEqual([
      { kind: "ordinary", player: "player1" },
      { kind: "bela", player: "player1" },
    ]);
    expect(notices[0]!.items.map(({ name, points }) => ({ name, points }))).toEqual([{ name: "Terca", points: 20 }]);
    expect(notices[1]!.items[0]!.cards.map(({ id }) => id)).toEqual(["zelje-K", "zelje-Q"]);
    expect(notices[1]!.pointsAwarded).toBe(false);
  });

  it("does not show an unawarded declaration and does not repeat stored awards after refresh", () => {
    const current = view();
    const first = getNewDeclarationNotices(current, new Set());
    const persistedIds = new Set(first.map(({ id }) => id));
    expect(getNewDeclarationNotices(current, persistedIds)).toEqual([]);
    expect(getNewDeclarationNotices({ ...current, awardedZvanja: { player1: [], player2: [] } }, persistedIds)).toEqual([]);
  });

  it("keeps the Bela notice identifier stable when the points are later awarded", () => {
    const announced = view();
    const noticeIds = new Set(getNewDeclarationNotices(announced, new Set()).map(({ id }) => id));
    const scored = {
      ...announced,
      belaAnnouncements: announced.belaAnnouncements.map((item) => ({ ...item, pointsAwarded: true })),
    };
    expect(getNewDeclarationNotices(scored, noticeIds)).toEqual([]);
  });
});
