import { Download, Eye, Hash, Heart, MessageCircle, Star, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../../../shared/lib/utils";
import type { StatIcon } from "../../lib/providers/types";
import { BotBrowserAssetImage } from "../BotBrowserAssetImage";

export const STAT_ICONS: Record<StatIcon, LucideIcon> = {
  star: Star,
  download: Download,
  heart: Heart,
  eye: Eye,
  message: MessageCircle,
  hash: Hash,
};

/** A card's picture through the proxy when needed, or a hash icon when it has none or it fails. */
export function CardPicture({
  src,
  alt,
  className,
  loading = "lazy",
}: {
  src: string | null;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn("flex items-center justify-center bg-[var(--muted)] text-[var(--muted-foreground)]", className)}
      >
        <Hash size="1.5rem" aria-hidden="true" />
      </span>
    );
  }
  return (
    <BotBrowserAssetImage
      src={src}
      alt={alt}
      loading={loading}
      className={cn("object-cover", className)}
      onError={() => setFailedSrc(src)}
    />
  );
}
