import { ExternalLink, Hash, Music2, Play, Shuffle, UserRound } from "lucide-react";

import { AvatarImage } from "../../../../shared/components/ui/AvatarImage";
import { cn } from "../../../../shared/lib/utils";
import type { ResolvedCharacterPublicProfile } from "../lib/character-public-profile";

type CharacterPublicProfileCardProps = {
  profile: ResolvedCharacterPublicProfile;
  avatarUrl?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  avatarCrop?: unknown;
  onOpenFullProfile?: () => void;
  onShuffleMusic?: () => void;
  onPlayMusic?: () => void;
  compact?: boolean;
  className?: string;
};

export function CharacterPublicProfileCard({
  profile,
  avatarUrl,
  avatarFilePath,
  avatarFilename,
  avatarCrop,
  onOpenFullProfile,
  onShuffleMusic,
  onPlayMusic,
  compact = false,
  className,
}: CharacterPublicProfileCardProps) {
  const tagLimit = compact ? 4 : 6;

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-xl",
        compact ? "max-w-72" : "max-w-sm",
        className,
      )}
    >
      <div className="relative h-20 bg-[var(--secondary)]">
        {profile.bannerImage ? (
          <img src={profile.bannerImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,rgba(244,114,182,0.28),rgba(34,197,94,0.16),rgba(56,189,248,0.22))]" />
        )}
      </div>

      <div className={cn("relative px-4 pb-4", compact ? "pt-8" : "pt-9")}>
        <div className="absolute -top-7 left-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border-2 border-[var(--popover)] bg-[var(--accent)] text-[var(--muted-foreground)] shadow-md">
          {avatarUrl ? (
            <AvatarImage
              src={avatarUrl}
              avatarFilePath={avatarFilePath}
              avatarFilename={avatarFilename}
              alt={profile.displayName}
              crop={avatarCrop}
              thumbnailSize={64}
            />
          ) : (
            <UserRound size="1.35rem" />
          )}
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--foreground)]">{profile.displayName}</div>
          {profile.handle && (
            <div className="mt-0.5 truncate text-[0.6875rem] text-[var(--muted-foreground)]">{profile.handle}</div>
          )}
          {profile.title && (
            <div className="mt-1 truncate text-[0.6875rem] italic text-[var(--muted-foreground)]">{profile.title}</div>
          )}
        </div>

        {profile.nowListeningLine && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--secondary)]/70 px-2 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
            <div className="flex min-w-0 items-center gap-1.5">
              <Music2 size="0.75rem" className="shrink-0 text-[var(--primary)]" />
              <span className="truncate">{profile.nowListeningLine}</span>
            </div>
            {(onShuffleMusic || onPlayMusic) && (
              <div className="flex shrink-0 items-center gap-1">
                {onShuffleMusic && (
                  <button
                    type="button"
                    onClick={onShuffleMusic}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    aria-label="Shuffle character music"
                    title="Shuffle character music"
                  >
                    <Shuffle size="0.75rem" />
                  </button>
                )}
                {onPlayMusic && (
                  <button
                    type="button"
                    onClick={onPlayMusic}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    aria-label="Play character music"
                    title="Play character music"
                  >
                    <Play size="0.75rem" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 line-clamp-4 text-xs leading-5 text-[var(--foreground)]/85">{profile.bio}</p>

        {profile.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.tags.slice(0, tagLimit).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)]"
              >
                <Hash size="0.625rem" />
                {tag}
              </span>
            ))}
            {profile.tags.length > tagLimit && (
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                +{profile.tags.length - tagLimit}
              </span>
            )}
          </div>
        )}

        {onOpenFullProfile && (
          <button
            type="button"
            onClick={onOpenFullProfile}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            <ExternalLink size="0.75rem" />
            View full profile
          </button>
        )}
      </div>
    </div>
  );
}

