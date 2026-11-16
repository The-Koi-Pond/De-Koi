import type { ReactNode } from "react";

import { useUIStore } from "../stores/ui.store";
import { POND_MODE_ICONS } from "./pond-icons";

/** Whether the Pond look (DESIGN.md section 7) is on. */
export function useIsPondTheme(): boolean {
  return useUIStore((s) => s.visualTheme) === "pond";
}

/**
 * A chat mode's icon: in the Pond theme De-Koi's own drawing (tea cup, kitsune mask, ink brush),
 * elsewhere `fallback`, the screen's usual icon. The Pond icons are drawn for 18px and up.
 */
export function ModeIcon({
  mode,
  fallback,
  size = "1.125rem",
  className,
}: {
  mode: string;
  fallback: ReactNode;
  size?: number | string;
  className?: string;
}) {
  const isPond = useIsPondTheme();
  const PondIcon = isPond ? POND_MODE_ICONS[mode as keyof typeof POND_MODE_ICONS] : undefined;
  if (!PondIcon) return <>{fallback}</>;
  return <PondIcon size={size} className={className} />;
}
