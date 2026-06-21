import { ResolvedAvatarImage } from "../../../../shared/components/ui/ResolvedAvatarImage";
import { cn } from "../../../../shared/lib/utils";
import { getCharacterAvatarLoadingMode } from "../lib/character-avatar-loading";

export function CharacterAvatarImage({
  src,
  avatarFilePath,
  avatarFilename,
  alt,
  crop,
  className,
  onError,
}: {
  src?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  alt: string;
  crop?: unknown;
  className?: string;
  onError?: () => void;
}) {
  return (
    <span className={cn("relative block h-full w-full overflow-hidden", className)}>
      <ResolvedAvatarImage
        src={src}
        avatarFilePath={avatarFilePath}
        avatarFilename={avatarFilename}
        alt={alt}
        crop={crop}
        loading={getCharacterAvatarLoadingMode(src)}
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover"
        onError={onError}
      />
    </span>
  );
}
