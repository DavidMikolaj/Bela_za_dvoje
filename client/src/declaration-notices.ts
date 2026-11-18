import type { AwardedZvanja, Player, PlayerGameView } from "./game-api";

export interface DeclarationNotice {
  readonly id: string;
  readonly player: Player;
  readonly kind: "ordinary" | "bela";
  readonly items: readonly AwardedZvanja[];
  readonly pointsAwarded?: boolean;
}

/** Creates public notices from server-awarded data only; unawarded declarations never enter the result. */
export function getNewDeclarationNotices(
  view: PlayerGameView,
  seenIds: ReadonlySet<string>,
): readonly DeclarationNotice[] {
  const fresh: DeclarationNotice[] = [];
  for (const player of ["player1", "player2"] as const) {
    const awards = view.awardedZvanja[player];
    const ordinary = awards.filter(({ kind }) => kind === "ordinary");
    if (ordinary.length) {
      const id = `${view.roundNumber}:ordinary:${player}:${ordinary.map(({ id: itemId }) => itemId).sort().join(",")}`;
      if (!seenIds.has(id)) fresh.push({ id, player, kind: "ordinary", items: ordinary });
    }
  }
  for (const bela of view.belaAnnouncements) {
    const id = `${view.roundNumber}:${bela.id}`;
    if (seenIds.has(id)) continue;
    fresh.push({ id, player: bela.player, kind: "bela", pointsAwarded: bela.pointsAwarded, items: [{
      id: bela.id, player: bela.player, name: "Bela", points: 20, cards: bela.cards, kind: "bela",
    }] });
  }
  return fresh;
}
