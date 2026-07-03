import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID,
  MUSIC_DJ_MINI_PLAYER_MODULE_ID,
} from "../../../../engine/contracts/constants/core-modules";
import { coreModulesApi } from "../../../../shared/api/core-modules-api";
import { dispatchMusicPlaybackEvent } from "../../../../shared/lib/music-playback-events";
import { buildCharacterMusicPlaybackCue, formatNowListeningLine } from "../lib/character-music-profile";
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
const MUSIC_DJ_MINI_PLAYER_HINT = "Enable Music DJ Mini Player in Settings > Modules to see playback controls.";

async function showMusicDjMiniPlayerHintIfNeeded() {
  const settings = await coreModulesApi.settings.get().catch(() => null);
  const enabled = settings?.enabled ?? {};
  if (enabled[MUSIC_DJ_MINI_PLAYER_MODULE_ID] === true || enabled[LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID] === true) {
    return;
  }
  toast.info(MUSIC_DJ_MINI_PLAYER_HINT, { duration: 5000 });
}

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
  const [musicShuffleOffset, setMusicShuffleOffset] = useState(0);
  const musicOptions = useMemo(
    () => (profile.musicOptions.length > 0 ? profile.musicOptions : profile.nowListening ? [profile.nowListening] : []),
    [profile.musicOptions, profile.nowListening],
  );
  const localMusicShuffleEnabled = !onShuffleMusic && musicOptions.length > 1;
  const selectedMusicIndex =
    musicOptions.length > 0
      ? (((profile.musicPickIndex + musicShuffleOffset) % musicOptions.length) + musicOptions.length) %
        musicOptions.length
      : 0;
  const displayedProfile = useMemo(() => {
    const nowListening = musicOptions[selectedMusicIndex] ?? profile.nowListening;
    if (nowListening === profile.nowListening && selectedMusicIndex === profile.musicPickIndex) return profile;
    return {
      ...profile,
      nowListening,
      nowListeningLine: formatNowListeningLine(nowListening),
      musicPickIndex: selectedMusicIndex,
    };
  }, [musicOptions, profile, selectedMusicIndex]);

  useEffect(() => {
    setMusicShuffleOffset(0);
  }, [profile]);

  const shuffleProfileMusic = useCallback(() => {
    if (musicOptions.length <= 1) return;
    setMusicShuffleOffset((current) => current + 1);
  }, [musicOptions.length]);
  const resolvedShuffleMusic = onShuffleMusic ?? (localMusicShuffleEnabled ? shuffleProfileMusic : undefined);
  const playProfileMusic = useCallback(() => {
    const cue = buildCharacterMusicPlaybackCue(displayedProfile.nowListening);
    if (!cue) return;
    void showMusicDjMiniPlayerHintIfNeeded();
    dispatchMusicPlaybackEvent({ type: "cue", query: cue.query });
  }, [displayedProfile.nowListening]);
  const playProvidedProfileMusic = useCallback(() => {
    if (!onPlayMusic) return;
    void showMusicDjMiniPlayerHintIfNeeded();
    onPlayMusic();
  }, [onPlayMusic]);
  const resolvedPlayMusic =
    localMusicShuffleEnabled || !onPlayMusic
      ? displayedProfile.nowListening
        ? playProfileMusic
        : undefined
      : playProvidedProfileMusic;

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
          profile={displayedProfile}
          avatarUrl={avatarUrl}
          avatarFilePath={avatarFilePath}
          avatarFilename={avatarFilename}
          avatarCrop={avatarCrop}
          compact
          onShuffleMusic={resolvedShuffleMusic}
          onPlayMusic={resolvedPlayMusic}
          onOpenFullProfile={onOpenFullProfile}
        />
      </div>
    </div>,
    document.body,
  );
}
