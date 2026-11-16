import type {
  BelaProgress,
  Card,
  DeclarationComparisonResult,
  Player,
  Rank,
  RoundScoreBreakdown,
  Suit,
  Declaration,
} from "./types.js";

const PLAYERS: readonly Player[] = ["player1", "player2"];
const RANKS: readonly Rank[] = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const rankIndex = (rank: Rank): number => RANKS.indexOf(rank);

export function getCardPointValue(card: Card, adut: Suit): number {
  if (card.suit === adut) {
    const points: Readonly<Record<Rank, number>> = { "7": 0, "8": 0, "9": 14, "10": 10, J: 20, Q: 3, K: 4, A: 11 };
    return points[card.rank];
  }
  const points: Readonly<Record<Rank, number>> = { "7": 0, "8": 0, "9": 0, "10": 10, J: 2, Q: 3, K: 4, A: 11 };
  return points[card.rank];
}

/** Detect maximal same-suit runs and point-bearing quads without mutating the hand. */
export function detectDeclarations(hand: readonly Card[]): Declaration[] {
  const found: Declaration[] = [];
  const suits = [...new Set(hand.map(({ suit }) => suit))];
  for (const suit of suits) {
    const suited = hand.filter((card) => card.suit === suit).sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank));
    let run: Card[] = [];
    const flush = () => {
      if (run.length >= 3) {
        const points = run.length === 3 ? 20 : run.length === 4 ? 50 : 100;
        found.push({ kind: "sequence", points, cards: [...run], sequenceLength: run.length, highestRank: run[run.length - 1]!.rank, rank: null });
      }
      run = [];
    };
    for (const card of suited) {
      if (run.length && rankIndex(card.rank) !== rankIndex(run[run.length - 1]!.rank) + 1) flush();
      run.push(card);
    }
    flush();
  }

  const byRank = new Map<Rank, Card[]>();
  for (const card of hand) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  for (const [rank, cards] of byRank) {
    if (cards.length !== 4) continue;
    const points = rank === "J" ? 200 : rank === "9" ? 150 : rank === "7" || rank === "8" ? 0 : 100;
    found.push({ kind: "four-of-kind", points, cards: [...cards], sequenceLength: null, highestRank: null, rank });
  }
  return found;
}

function strengthCompare(left: Declaration, right: Declaration): number {
  if (left.points !== right.points) return left.points - right.points;
  if (left.kind === "sequence" && right.kind === "sequence") {
    if (left.sequenceLength !== right.sequenceLength) return left.sequenceLength! - right.sequenceLength!;
    return rankIndex(left.highestRank!) - rankIndex(right.highestRank!);
  }
  return 0;
}

function keyFor(declaration: Declaration): string {
  return declaration.cards.map(({ id }) => id).sort().join("|");
}

/** Resolve the strongest individual declaration, then score the winner's best disjoint set. */
export function compareDeclarations(
  detectedByPlayer: Readonly<Record<Player, readonly Declaration[]>>,
  dealer: Player,
  nonDealer: Player,
): DeclarationComparisonResult {
  const eligible = {
    player1: detectedByPlayer.player1.filter((declaration) => declaration.points > 0),
    player2: detectedByPlayer.player2.filter((declaration) => declaration.points > 0),
  };
  const best = (player: Player) => eligible[player].reduce<Declaration | null>(
    (current, declaration) => current === null || strengthCompare(declaration, current) > 0 ? declaration : current,
    null,
  );
  const firstBest = best("player1");
  const secondBest = best("player2");
  let winner: Player | null;
  if (!firstBest) winner = secondBest ? "player2" : null;
  else if (!secondBest) winner = "player1";
  else {
    const compared = strengthCompare(firstBest, secondBest);
    winner = compared === 0 ? nonDealer : compared > 0 ? "player1" : "player2";
  }

  const pointsAwarded: Record<Player, number> = { player1: 0, player2: 0 };
  const scoredByPlayer: Record<Player, readonly Declaration[]> = { player1: [], player2: [] };
  if (winner) {
    const declarations = eligible[winner];
    let bestTotal = -1;
    let bestSet: Declaration[] = [];
    const visit = (index: number, used: Set<string>, picked: Declaration[], total: number) => {
      if (index === declarations.length) {
        const pickedKey = picked.map(keyFor).sort().join(";");
        const bestKey = bestSet.map(keyFor).sort().join(";");
        if (total > bestTotal || (total === bestTotal && pickedKey < bestKey)) {
          bestTotal = total;
          bestSet = [...picked];
        }
        return;
      }
      visit(index + 1, used, picked, total);
      const declaration = declarations[index]!;
      if (declaration.cards.some(({ id }) => used.has(id))) return;
      const next = new Set(used);
      declaration.cards.forEach(({ id }) => next.add(id));
      visit(index + 1, next, [...picked, declaration], total + declaration.points);
    };
    visit(0, new Set(), [], 0);
    pointsAwarded[winner] = Math.max(0, bestTotal);
    scoredByPlayer[winner] = bestSet;
  }
  // Parameters document the bidding roles; equal strongest declarations go to the non-dealer.
  void dealer;
  return { winner, pointsAwarded, scoredByPlayer };
}

export function updateBela(
  progress: BelaProgress,
  playerPoints: number,
  card: Card,
  adut: Suit,
): { readonly progress: BelaProgress; readonly points: number } {
  if (card.suit !== adut || progress.awarded || (card.rank !== "K" && card.rank !== "Q")) {
    return { progress, points: playerPoints };
  }
  const next: BelaProgress = {
    kingPlayed: progress.kingPlayed || card.rank === "K",
    queenPlayed: progress.queenPlayed || card.rank === "Q",
    awarded: progress.awarded || ((progress.kingPlayed || card.rank === "K") && (progress.queenPlayed || card.rank === "Q")),
  };
  return { progress: next, points: playerPoints + (next.awarded && !progress.awarded ? 20 : 0) };
}

export function settleRoundScore(input: {
  readonly caller: Player;
  readonly trickPoints: Readonly<Record<Player, number>>;
  readonly declarationPoints: Readonly<Record<Player, number>>;
  readonly belaPoints: Readonly<Record<Player, number>>;
  readonly tricksWon: Readonly<Record<Player, number>>;
  readonly lastTrickWinner: Player;
}): RoundScoreBreakdown {
  const lastTrickBonus: Record<Player, number> = { player1: 0, player2: 0 };
  lastTrickBonus[input.lastTrickWinner] = 10;
  const stigljaBonus: Record<Player, number> = { player1: 0, player2: 0 };
  if (input.tricksWon.player1 === 10) stigljaBonus.player1 = 90;
  if (input.tricksWon.player2 === 10) stigljaBonus.player2 = 90;
  const roundTotals = Object.fromEntries(PLAYERS.map((player) => [player,
    input.trickPoints[player] + input.declarationPoints[player] + input.belaPoints[player] + lastTrickBonus[player] + stigljaBonus[player],
  ])) as Record<Player, number>;
  const opponent: Player = input.caller === "player1" ? "player2" : "player1";
  const contractSucceeded = roundTotals[input.caller] > roundTotals[opponent];
  const matchPointsAwarded: Record<Player, number> = contractSucceeded
    ? { ...roundTotals }
    : { player1: 0, player2: 0 };
  if (!contractSucceeded) matchPointsAwarded[opponent] = roundTotals.player1 + roundTotals.player2;
  return {
    caller: input.caller,
    contractSucceeded,
    trickPoints: { ...input.trickPoints },
    declarationPoints: { ...input.declarationPoints },
    belaPoints: { ...input.belaPoints },
    lastTrickBonus,
    stigljaBonus,
    roundTotals,
    matchPointsAwarded,
  };
}

export function getMatchWinner(scores: Readonly<Record<Player, number>>, target = 1001): Player | null {
  const firstReached = scores.player1 >= target;
  const secondReached = scores.player2 >= target;
  if (!firstReached && !secondReached) return null;
  if (firstReached && secondReached) {
    return scores.player1 === scores.player2 ? null : scores.player1 > scores.player2 ? "player1" : "player2";
  }
  return firstReached ? "player1" : "player2";
}
