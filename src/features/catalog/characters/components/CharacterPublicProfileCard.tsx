import { ExternalLink, Hash, UserRound } from "lucide-react";

import { cn } from "../../../../shared/lib/utils";
import type { ResolvedCharacterPublicProfile } from "../lib/character-public-profile";

type CharacterPublicProfileCardProps = {
  profile: ResolvedCharacterPublicProfile;
  avatarUrl?: string | null;
  onOpenFullProfile?: () => void;
  compact?: boolean;
  className?: string;
};

export function CharacterPublicProfileCard({
  profile,
  avatarUrl,
  onOpenFullProfile,
  compact = false,
  className,
}: CharacterPublicProfileCardProps) {
  const tagLimit = compact ? 4 : 6;

  return (
    <div
      data-profile-card
      className={cn(
        "w-full overflow-hidden rounded-lg border border-white/10 bg-[var(--popover)] text-[var(--popover-foreground)] shadow-2xl shadow-black/35",
        compact ? "max-w-80" : "max-w-sm",
        className,
      )}
    >
      <div className={cn("relative bg-[var(--secondary)]", compact ? "h-24" : "h-28")}>
        {profile.bannerImage ? (
          <img src={profile.bannerImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,rgba(244,114,182,0.34),rgba(20,184,166,0.22),rgba(56,189,248,0.28))]" />
        )}
      </div>

      <div className={cn("relative px-4 pb-4", compact ? "pt-10" : "pt-11")}>
        <div
          data-profile-avatar
          className={cn(
            "absolute left-4 flex items-center justify-center overflow-hidden rounded-full border-4 border-[var(--popover)] bg-[var(--accent)] text-[var(--muted-foreground)] shadow-lg",
            compact ? "-top-8 h-16 w-16" : "-top-9 h-[4.5rem] w-[4.5rem]",
          )}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
          ) : (
            <UserRound size={compact ? "1.45rem" : "1.65rem"} />
          )}
        </div>

        <div className="min-w-0">
          <div className="truncate text-base font-semibold leading-tight text-[var(--foreground)]">
            {profile.displayName}
          </div>
          {profile.handle && (
            <div className="mt-0.5 truncate text-[0.6875rem] text-[var(--muted-foreground)]">{profile.handle}</div>
          )}
          {profile.title && (
            <div className="mt-1 truncate text-[0.6875rem] italic text-[var(--muted-foreground)]">{profile.title}</div>
          )}
        </div>

        <p className="mt-3 line-clamp-5 text-xs leading-5 text-[var(--foreground)]/85">{profile.bio}</p>

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
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-2 text-[0.6875rem] font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            <ExternalLink size="0.75rem" />
            View full profile
          </button>
        )}
      </div>
    </div>
  );
}
