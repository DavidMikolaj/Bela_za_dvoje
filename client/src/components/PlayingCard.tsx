import { useState } from "react";
import type { Card } from "../game-api";
import { CARD_BACK_ASSET_PATH, getPlayingCardAssetPath } from "./card-assets";

export interface PlayingCardProps {
  readonly card?: Card;
  readonly faceDown?: boolean;
  readonly backLabel?: string;
  readonly onPlay?: () => void;
  readonly disabled?: boolean;
  readonly legal?: boolean;
}

/** Lice i naličje mađarice s tekstualnom zamjenom i mogućnošću odigravanja karte. */
export function PlayingCard({
  card,
  faceDown = false,
  backLabel = "Karta okrenuta licem prema dolje",
  onPlay,
  disabled = false,
  legal = false,
}: PlayingCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const isBack = faceDown || !card;
  const label = isBack ? backLabel : `${card.rank} ${card.suit}`;
  const className = [
    "playing-card",
    isBack ? "card-back" : "",
    onPlay ? "selectable-card" : "",
    onPlay && legal ? "legal-card" : "",
    onPlay && !legal ? "illegal-card" : "",
  ].filter(Boolean).join(" ");
  const imagePath = isBack ? CARD_BACK_ASSET_PATH : getPlayingCardAssetPath(card);
  const content = imageFailed
    ? <span className="card-image-fallback">{isBack ? "BA" : <><strong>{card.rank}</strong><span>{card.suit}</span></>}</span>
    : <img className="card-artwork" src={imagePath} alt="" draggable={false} onError={() => setImageFailed(true)} />;

  if (onPlay) {
    return <button type="button" className={className} aria-label={`Odigraj: ${label}`} onClick={onPlay} disabled={disabled}>{content}</button>;
  }
  return <div className={className} role="img" aria-label={label}>{content}</div>;
}
