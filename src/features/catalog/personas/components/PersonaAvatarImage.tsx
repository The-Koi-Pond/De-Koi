import type { CSSProperties } from "react";

import { AvatarImage, type AvatarImageSizeHint } from "../../../../shared/components/ui/AvatarImage";

export type PersonaAvatarImageSource = {
  name?: string | null;
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  avatarCrop?: unknown;
};

export function PersonaAvatarImage({
  persona,
  alt,
  className,
  draggable = false,
  style,
  thumbnailSize,
}: {
  persona: PersonaAvatarImageSource;
  alt?: string;
  className?: string;
  draggable?: boolean;
  style?: CSSProperties;
  thumbnailSize?: AvatarImageSizeHint;
}) {
  return (
    <AvatarImage
      src={persona.avatarPath}
      avatarFilePath={persona.avatarFilePath}
      avatarFilename={persona.avatarFilename}
      alt={alt ?? persona.name ?? ""}
      crop={persona.avatarCrop}
      className={className}
      draggable={draggable}
      imageStyle={style}
      thumbnailSize={thumbnailSize}
    />
  );
}
