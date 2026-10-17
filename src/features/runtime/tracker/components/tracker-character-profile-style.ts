import type { CSSProperties } from "react";
import type { PresentCharacter } from "../../../../engine/contracts/types/tracker-state";
import {
  DEFAULT_TRACKER_CARD_ACCENT,
  TRACKER_CARD_NEUTRAL_LIFT,
  TRACKER_CARD_NEUTRAL_MATERIAL,
  TRACKER_CARD_NEUTRAL_SURFACE_BOTTOM,
  TRACKER_CARD_NEUTRAL_SURFACE_TOP,
  getTrackerCardCssPaintValue,
  getTrackerCardSkinFinish,
  getTrackerCardSolidColor,
  parseTrackerCardColorConfig,
} from "../../../../shared/lib/tracker-card-colors";
import { type TrackerProfileColors, getTrackerProfilePalette } from "./tracker-profile-colors";
import { withTrackerProfileStyle } from "./tracker-profile-style-vars";

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function opacityWeight(value: number) {
  return clampPercent(value) / 100;
}

function scalePercent(value: number, opacity: number) {
  return Math.round(value * opacityWeight(opacity));
}

function getStrengthAdjustedProfileColor(color: string, opacity: number, neutral: string) {
  const clampedOpacity = clampPercent(opacity);
  if (clampedOpacity >= 100) return color;
  if (clampedOpacity <= 0) return neutral;
  return `color-mix(in srgb, ${neutral} ${100 - clampedOpacity}%, ${color} ${clampedOpacity}%)`;
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getSolidCssColor(value: string | null | undefined) {
  return getTrackerCardSolidColor(value);
}

export function getCharacterProfileColors(rawData: unknown): TrackerProfileColors | null {
  try {
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const data = record?.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
    const extensions =
      data?.extensions && typeof data.extensions === "object" && !Array.isArray(data.extensions)
        ? (data.extensions as Record<string, unknown>)
        : null;

    const trackerCardColorsRaw = extensions?.trackerCardColors;
    const profileColors: TrackerProfileColors = {
      dialogueColor: getTrackerCardCssPaintValue(getStringValue(extensions?.dialogueColor)),
      nameColor: getTrackerCardCssPaintValue(getStringValue(extensions?.nameColor)),
      boxColor: getTrackerCardCssPaintValue(getStringValue(extensions?.boxColor)),
      ...(trackerCardColorsRaw !== undefined && {
        trackerCardColors: parseTrackerCardColorConfig(trackerCardColorsRaw),
      }),
    };

    return profileColors.dialogueColor ||
      profileColors.nameColor ||
      profileColors.boxColor ||
      profileColors.trackerCardColors
      ? profileColors
      : null;
  } catch {
    return null;
  }
}

export function getCharacterAmbienceStyle(
  character: PresentCharacter,
  profileColors?: TrackerProfileColors | null,
): CSSProperties {
  const palette = getTrackerProfilePalette(
    profileColors,
    getSolidCssColor(character.stats?.find((stat) => stat.color)?.color) ?? DEFAULT_TRACKER_CARD_ACCENT,
  );
  const finish = getTrackerCardSkinFinish(palette.finish);
  const surfaceOpacity = palette.hasSurfacePaint ? palette.opacity.boxColorOpacity : 0;
  const hasActiveSurface = surfaceOpacity > 0;
  const boxMix = scalePercent(Math.min(32, Math.round(finish.surfaceBoxMix * 0.9)), surfaceOpacity);
  const backMix = Math.round(boxMix * 0.68);
  const effectiveBox = getStrengthAdjustedProfileColor(palette.box, surfaceOpacity, TRACKER_CARD_NEUTRAL_MATERIAL);
  const surfaceMaterialPaint = hasActiveSurface
    ? `color-mix(in srgb, ${effectiveBox} 88%, ${TRACKER_CARD_NEUTRAL_LIFT} 12%)`
    : effectiveBox;
  const materialTopBase = TRACKER_CARD_NEUTRAL_SURFACE_TOP;
  const materialDepthBase = TRACKER_CARD_NEUTRAL_SURFACE_BOTTOM;
  return withTrackerProfileStyle(
    palette,
    `linear-gradient(135deg, color-mix(in srgb, ${materialTopBase} ${100 - boxMix}%, ${surfaceMaterialPaint} ${boxMix}%), ` +
      `color-mix(in srgb, ${materialDepthBase} ${100 - backMix}%, ${surfaceMaterialPaint} ${backMix}%))`,
  );
}
