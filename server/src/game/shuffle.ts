import { randomInt } from "node:crypto";
import type { Card } from "./types.js";

/** Fisher-Yates shuffle. The input deck is not modified. */
export function shuffleDeck(deck: readonly Card[]): Card[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}
