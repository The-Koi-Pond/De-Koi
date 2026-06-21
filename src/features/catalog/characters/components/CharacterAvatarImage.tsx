import { AvatarImage, type AvatarImageSizeHint } from "../../../../shared/components/ui/AvatarImage";

export function CharacterAvatarImage({
  src,
  avatarFilePath,
  avatarFilename,
  alt,
  crop,
  className,
  thumbnailSize,
  onError,
}: {
  src?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  alt: string;
  crop?: unknown;
  className?: string;
  thumbnailSize?: AvatarImageSizeHint;
  onError?: () => void;
}) {
  return (
    <AvatarImage
      src={src}
      avatarFilePath={avatarFilePath}
      avatarFilename={avatarFilename}
      alt={alt}
      crop={crop}
      className={className}
      thumbnailSize={thumbnailSize}
      onError={onError}
    />
  );
}
