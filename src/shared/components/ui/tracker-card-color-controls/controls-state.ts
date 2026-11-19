import type { CSSProperties } from "react";

import type { TrackerCardColorConfig } from "../../../../engine/contracts/types/persona";
import {
  cleanTrackerCardColorConfig,
  getTrackerCardFinish,
  getTrackerCardPaintEnabled,
  getTrackerCardPaintOpacity,
  getTrackerCardPortraitStageBackground,
  normalizeTrackerCardColorMode,
  parseTrackerCardColorConfig,
  type TrackerCardPaintColors,
} from "../../../lib/tracker-card-colors";
import { MODE_OPTIONS, PAINT_CHANNELS, STAGE_OPTIONS, type PaintChannel } from "./options";

const CHECKERBOARD: CSSProperties = {
  backgroundImage: "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%)",
  backgroundSize: "6px 6px",
};

/** The config the controls show and edit: what `value` says, read through the team helpers. */
export function readCurrentConfig(value: TrackerCardColorConfig | string | null | undefined): TrackerCardColorConfig {
  return typeof value === "string" ? parseTrackerCardColorConfig(value) : cleanTrackerCardColorConfig(value);
}

function hasText(color: string | null | undefined) {
  return typeof color === "string" && color.trim() !== "";
}

/** Chat colors as text only: a number or object (e.g. from an imported card) counts as no color. */
export function readChatColors(colors: TrackerCardPaintColors | null | undefined): TrackerCardPaintColors {
  const read = (color: unknown) => (typeof color === "string" ? color : "");
  return {
    nameColor: read(colors?.nameColor),
    dialogueColor: read(colors?.dialogueColor),
    boxColor: read(colors?.boxColor),
  };
}

/** Surface needs its own color; Display and Accent light up when either of them has one. */
function channelHasPaint(channel: PaintChannel, colors: TrackerCardPaintColors) {
  if (channel.colorField === "boxColor") return hasText(colors.boxColor);
  return hasText(colors.nameColor) || hasText(colors.dialogueColor);
}

export function swatchStyle(color: string | null | undefined): CSSProperties {
  if (color?.includes("gradient(")) return { background: color };
  if (color) return { backgroundColor: color };
  return CHECKERBOARD;
}

export interface ChannelView {
  channel: PaintChannel;
  /** The config's own color for this channel (in any mode), else "". The Custom picker edits it. */
  ownColor: string;
  /** The color the header swatch shows. */
  effectiveColor: string | null | undefined;
  enabled: boolean;
  hasPaint: boolean;
  strength: number;
  /** "off", "none" or "<strength>%". */
  valueLabel: string;
}

export function describeControls(config: TrackerCardColorConfig, chatColors: TrackerCardPaintColors) {
  const mode = normalizeTrackerCardColorMode(config.mode);
  const finish = getTrackerCardFinish(config, mode);
  const enabled = getTrackerCardPaintEnabled(config);
  const opacity = getTrackerCardPaintOpacity(config);
  const stage = getTrackerCardPortraitStageBackground(config);
  const ownColors: TrackerCardPaintColors = {
    nameColor: config.nameColor,
    dialogueColor: config.dialogueColor,
    boxColor: config.boxColor,
  };
  const effectiveColors: TrackerCardPaintColors = mode === "custom" ? ownColors : mode === "chat" ? chatColors : {};

  const channels: ChannelView[] = PAINT_CHANNELS.map((channel) => {
    const isEnabled = enabled[channel.enabledField];
    const hasPaint = channelHasPaint(channel, effectiveColors);
    const strength = opacity[channel.opacityField];
    return {
      channel,
      ownColor: config[channel.colorField] ?? "",
      effectiveColor: effectiveColors[channel.colorField],
      enabled: isEnabled,
      hasPaint,
      strength,
      valueLabel: !isEnabled ? "off" : !hasPaint ? "none" : `${strength}%`,
    };
  });

  const modeLabel = MODE_OPTIONS.find((option) => option.value === mode)!.label;
  const stageLabel = STAGE_OPTIONS.find((option) => option.value === stage)!.label;
  const { materialBrightness, glowIntensity, contrastIntensity } = finish;

  return {
    mode,
    stage,
    finish,
    channels,
    summary: `${modeLabel}, ${stageLabel.toLowerCase()} stage, finish M/G/C ${materialBrightness}/${glowIntensity}/${contrastIntensity}.`,
    strengthSummary: channels.map((view) => (view.enabled ? String(view.strength) : "off")).join("/"),
  };
}
