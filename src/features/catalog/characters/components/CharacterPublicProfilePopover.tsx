import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import { dispatchMusicPlaybackEvent } from "../../../../shared/lib/music-playback-events";
import { buildCharacterMusicPlaybackCue } from "../lib/character-music-profile";
import type { ResolvedCharacterPublicProfile } from "../lib/character-public-profile";
import { CharacterPublicProfileCard } from "./CharacterPublicProfileCard";

export type CharacterPublicProfilePopoverAnchor = Pick<
  DOMRect,
  "top" | "right" | "bottom" | "left" | "width" | "height" | "x" | "y"
>;

type CharacterPublicProfilePopoverProps = {
  profile: ResolvedCharacterPublicProfile;
  avatarUrl?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  avatarCrop?: unknown;
  anchorRect?: CharacterPublicProfilePopoverAnchor | null;
  onClose: () => void;
  onShuffleMusic?: () => void;
  onPlayMusic?: () => void;
  onOpenFullProfile?: () => void;
};

const CARD_WIDTH = 320;
const CARD_MAX_HEIGHT = 448;
const EDGE_GAP = 8;
const ANCHOR_GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPopoverPosition(anchorRect?: CharacterPublicProfilePopoverAnchor | null) {
  if (typeof window === "undefined") return undefined;
  const maxHeight = Math.max(180, window.innerHeight - EDGE_GAP * 2);
  const panelHeight = Math.min(CARD_MAX_HEIGHT, maxHeight);

  if (!anchorRect) {
    return {
      top: 64,
      left: Math.max(EDGE_GAP, window.innerWidth - CARD_WIDTH - 12),
      maxHeight: panelHeight,
    };
  }

  const maxLeft = Math.max(EDGE_GAP, window.innerWidth - CARD_WIDTH - EDGE_GAP);
  const preferredTop = anchorRect.bottom + ANCHOR_GAP;
  const top =
    preferredTop + panelHeight > window.innerHeight - EDGE_GAP
      ? clamp(anchorRect.top - ANCHOR_GAP - panelHeight, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - EDGE_GAP))
      : preferredTop;
  return {
    top: Math.max(EDGE_GAP, top),
    left: clamp(anchorRect.left, EDGE_GAP, maxLeft),
    maxHeight: panelHeight,
  };
}

export function CharacterPublicProfilePopover({
  profile,
  avatarUrl,
  avatarFilePath,
  avatarFilename,
  avatarCrop,
  anchorRect,
  onClose,
  onShuffleMusic,
  onPlayMusic,
  onOpenFullProfile,
}: CharacterPublicProfilePopoverProps) {
  const position = useMemo(() => getPopoverPosition(anchorRect), [anchorRect]);
  const playProfileMusic = useCallback(() => {
    const cue = buildCharacterMusicPlaybackCue(profile.nowListening);
    if (!cue) return;
    dispatchMusicPlaybackEvent({ type: "cue", query: cue.query });
  }, [profile.nowListening]);
  const resolvedPlayMusic = onPlayMusic ?? (profile.nowListening ? playProfileMusic : undefined);

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
          avatarFilePath={avatarFilePath}
          avatarFilename={avatarFilename}
          avatarCrop={avatarCrop}
          compact
          onShuffleMusic={onShuffleMusic}
          onPlayMusic={resolvedPlayMusic}
          onOpenFullProfile={onOpenFullProfile}
        />
      </div>
    </div>,
    document.body,
  );
}
