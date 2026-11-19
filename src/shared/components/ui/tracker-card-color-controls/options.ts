import { Circle, Image, Layers, MessageSquare, Palette, Sparkles, Square, type LucideIcon } from "lucide-react";

import type {
  TrackerCardColorConfig,
  TrackerCardColorMode,
  TrackerCardPortraitStageBackground,
} from "../../../../engine/contracts/types/persona";
import type {
  TrackerCardFinish,
  TrackerCardPaintEnabled,
  TrackerCardPaintOpacity,
} from "../../../lib/tracker-card-colors";

export const MODE_OPTIONS: { value: TrackerCardColorMode; label: string; icon: LucideIcon }[] = [
  { value: "default", label: "Default", icon: Palette },
  { value: "chat", label: "Chat colors", icon: MessageSquare },
  { value: "custom", label: "Custom", icon: Sparkles },
];

export const STAGE_OPTIONS: {
  value: TrackerCardPortraitStageBackground;
  label: string;
  title: string;
  icon: LucideIcon;
}[] = [
  { value: "ambient", label: "Ambient", title: "Balanced color wash", icon: Layers },
  { value: "spotlight", label: "Spotlight", title: "Focused center glow", icon: Circle },
  { value: "soft", label: "Haze", title: "Diffused portrait glow", icon: Image },
  { value: "plain", label: "Plain", title: "Quiet neutral stage", icon: Square },
];

export const FINISH_PRESETS: { label: string; title: string; finish: TrackerCardFinish }[] = [
  {
    label: "Soft",
    title: "Brighter material with gentle glow and mild separation",
    finish: { tintIntensity: 100, materialBrightness: 54, glowIntensity: 24, contrastIntensity: 58 },
  },
  {
    label: "Crisp",
    title: "Neutral material with clearer edges and medium glow",
    finish: { tintIntensity: 100, materialBrightness: 50, glowIntensity: 46, contrastIntensity: 64 },
  },
  {
    label: "Vivid",
    title: "Darker material with strong glow and high contrast",
    finish: { tintIntensity: 100, materialBrightness: 44, glowIntensity: 82, contrastIntensity: 86 },
  },
];

export const FINISH_SLIDERS: {
  field: "materialBrightness" | "glowIntensity" | "contrastIntensity";
  label: string;
  title: string;
}[] = [
  { field: "materialBrightness", label: "Material", title: "Brightness of neutral and Surface card material" },
  { field: "glowIntensity", label: "Glow", title: "Light from edges, portrait, stats, and nameplate" },
  { field: "contrastIntensity", label: "Contrast", title: "Text readability and neutral panel separation" },
];

export interface PaintChannel {
  label: "Display" | "Accent" | "Surface";
  colorField: "nameColor" | "dialogueColor" | "boxColor";
  opacityField: keyof TrackerCardPaintOpacity;
  enabledField: keyof TrackerCardPaintEnabled & keyof TrackerCardColorConfig;
  title: string;
  emptyText: string;
}

export const PAINT_CHANNELS: PaintChannel[] = [
  {
    label: "Display",
    colorField: "nameColor",
    opacityField: "nameColorOpacity",
    enabledField: "displayEnabled",
    title: "Names, readable field tint, and identity emphasis",
    emptyText: "No display color set",
  },
  {
    label: "Accent",
    colorField: "dialogueColor",
    opacityField: "dialogueColorOpacity",
    enabledField: "accentEnabled",
    title: "Borders, icons, highlights, buttons, and glow",
    emptyText: "No accent color set",
  },
  {
    label: "Surface",
    colorField: "boxColor",
    opacityField: "boxColorOpacity",
    enabledField: "surfaceEnabled",
    title: "Card body, panels, shelves, and field material",
    emptyText: "No surface color - neutral card",
  },
];
