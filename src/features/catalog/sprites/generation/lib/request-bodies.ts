import {
  compileImagePrompt,
  spriteImageNegativePrompt,
  type ImageStyleProfileSettings,
} from "../../../../../engine/generation/image-style-profiles";
import type { ImagePromptOverride } from "../../../../../shared/components/ui/ImagePromptReviewModal";
import type { SpriteGrid, SpriteType } from "./sprite-lists";

export const MAX_REFERENCE_IMAGES = 4;

/** The body of `sprite_generate_sheet_preview` and `sprite_generate_sheet`. Optional fields are left out of the JSON. */
export type SpriteGenerationBody = {
  connectionId: string;
  appearance: string;
  referenceImages?: string[];
  expressions: string[];
  cols: number;
  rows: number;
  spriteType: SpriteType;
  fullBodyExpressionMode: boolean;
  nativeTransparentPng: boolean;
  negativePrompt?: string;
  /** Always false: the dialog cleans backgrounds itself, so Rust returns the provider's raw output. */
  noBackground: false;
  promptOverrides?: ImagePromptOverride[];
};

export interface SpriteGenerationInput {
  connectionId: string;
  /** Sent exactly as typed, not trimmed. */
  appearance: string;
  referenceImages: readonly string[];
  expressions: readonly string[];
  grid: SpriteGrid;
  spriteType: SpriteType;
  matched: boolean;
  nativeTransparentPng: boolean;
  negativePrompt: string;
}

export function buildGenerationBody(input: SpriteGenerationInput): SpriteGenerationBody {
  const referenceImages = input.referenceImages.slice(0, MAX_REFERENCE_IMAGES);
  return {
    connectionId: input.connectionId,
    appearance: input.appearance,
    ...(referenceImages.length > 0 ? { referenceImages } : {}),
    expressions: [...input.expressions],
    cols: input.grid.cols,
    rows: input.grid.rows,
    spriteType: input.spriteType,
    fullBodyExpressionMode: input.matched,
    nativeTransparentPng: input.nativeTransparentPng,
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    noBackground: false,
  };
}

/** The confirmed prompt review's overrides, handed over unchanged. */
export function withPromptOverrides(
  body: SpriteGenerationBody,
  overrides: ImagePromptOverride[],
): SpriteGenerationBody {
  return { ...body, promptOverrides: overrides };
}

/** The reference pictures sent: the avatar first (when its box is on), then the uploads, at most four. */
export function referenceImagesToSend(
  avatarUrl: string | null | undefined,
  useAvatar: boolean,
  uploads: readonly string[],
): string[] {
  const avatar = useAvatar && avatarUrl ? [avatarUrl] : [];
  return [...avatar, ...uploads].slice(0, MAX_REFERENCE_IMAGES);
}

/**
 * The sprite negative prompt, compiled with the user's default image style profile. Matched batches and plain
 * full-body sheets get different ones.
 */
export function spriteNegativePrompt(
  spriteType: SpriteType,
  matched: boolean,
  styleProfiles: ImageStyleProfileSettings,
): string {
  return compileImagePrompt({
    kind: "sprite",
    prompt: "",
    negativePrompt: spriteImageNegativePrompt({ spriteType, fullBodyExpressionMode: matched }),
    styleProfiles,
    styleProfileId: styleProfiles.defaultProfileId,
  }).negativePrompt.trim();
}

export type SpriteCleanupCell = {
  /** The sprite's name as held, not its save form. */
  expression: string;
  /** The sprite's original picture as a full data URL, never the cleaned one. */
  base64: string;
};

export type SpriteCleanupBody = {
  cleanupStrength: number;
  engine: "auto";
  cells: SpriteCleanupCell[];
};

export function buildCleanupBody(strength: number, cells: readonly SpriteCleanupCell[]): SpriteCleanupBody {
  return { cleanupStrength: Math.round(strength), engine: "auto", cells: [...cells] };
}

/** How the dialog shows every picture a reply carries as bare base64, whatever the provider's format. */
export function pngDataUrl(bareBase64: string): string {
  return `data:image/png;base64,${bareBase64}`;
}
