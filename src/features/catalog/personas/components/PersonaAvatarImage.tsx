import type { CSSProperties } from "react";

import { ResolvedAvatarImage } from "../../../../shared/components/ui/ResolvedAvatarImage";
import { cn } from "../../../../shared/lib/utils";

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
}: {
  persona: PersonaAvatarImageSource;
  alt?: string;
  className?: string;
  draggable?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span className={cn("relative block h-full w-full overflow-hidden", className)} style={style}>
      <ResolvedAvatarImage
        src={persona.avatarPath}
        avatarFilePath={persona.avatarFilePath}
        avatarFilename={persona.avatarFilename}
        alt={alt ?? persona.name ?? ""}
        crop={persona.avatarCrop}
        loading="lazy"
        decoding="async"
        draggable={draggable}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
