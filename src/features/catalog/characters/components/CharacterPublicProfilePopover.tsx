import { useMemo } from "react";
import { createPortal } from "react-dom";

import type { ResolvedCharacterPublicProfile } from "../lib/character-public-profile";
import { CharacterPublicProfileCard } from "./CharacterPublicProfileCard";

export type CharacterPublicProfilePopoverAnchor = Pick<
  DOMRect,
  "top" | "right" | "bottom" | "left" | "width" | "height" | "x" | "y"
>;

type CharacterPublicProfilePopoverProps = {
  profile: ResolvedCharacterPublicProfile;
  avatarUrl?: string | null;
  anchorRect?: CharacterPublicProfilePopoverAnchor | null;
  onClose: () => void;
  onOpenFullProfile?: () => void;
};

const CARD_WIDTH = 320;
const EDGE_GAP = 8;
const ANCHOR_GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPopoverPosition(anchorRect?: CharacterPublicProfilePopoverAnchor | null) {
  if (typeof window === "undefined") return undefined;

  if (!anchorRect) {
    return {
      top: 64,
      left: Math.max(EDGE_GAP, window.innerWidth - CARD_WIDTH - 12),
    };
  }

  const maxLeft = Math.max(EDGE_GAP, window.innerWidth - CARD_WIDTH - EDGE_GAP);
  return {
    top: Math.max(EDGE_GAP, anchorRect.bottom + ANCHOR_GAP),
    left: clamp(anchorRect.left, EDGE_GAP, maxLeft),
  };
}

export function CharacterPublicProfilePopover({
  profile,
  avatarUrl,
  anchorRect,
  onClose,
  onOpenFullProfile,
}: CharacterPublicProfilePopoverProps) {
  const position = useMemo(() => getPopoverPosition(anchorRect), [anchorRect]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-transparent" onClick={onClose}>
      <div
        data-profile-popover
        className="fixed max-h-[calc(100vh-1rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto max-sm:left-1/2! max-sm:top-14! max-sm:-translate-x-1/2"
        style={position}
        onClick={(event) => event.stopPropagation()}
      >
        <CharacterPublicProfileCard
          profile={profile}
          avatarUrl={avatarUrl}
          compact
          onOpenFullProfile={onOpenFullProfile}
        />
      </div>
    </div>,
    document.body,
  );
}
