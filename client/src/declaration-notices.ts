import type { AwardedZvanja, Player, PlayerGameView } from "./game-api";

export interface DeclarationNotice {
  readonly id: string;
  readonly player: Player;
  readonly kind: "ordinary" | "bela";
  readonly items: readonly AwardedZvanja[];
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
    for (const bela of awards.filter(({ kind }) => kind === "bela")) {
      const id = `${view.roundNumber}:${bela.id}`;
      if (!seenIds.has(id)) fresh.push({ id, player, kind: "bela", items: [bela] });
    }
  }
  return fresh;
}
