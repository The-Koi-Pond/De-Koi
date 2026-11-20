export type ImageDefaultsService = "automatic1111" | "comfyui" | "novelai";

/** How the selfie prompt writer words prompts for this connection. */
export type ImagePromptWording = "tags" | "descriptive";

export interface Automatic1111Defaults {
  promptPrefix: string;
  negativePromptPrefix: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfgScale: number;
  clipSkip: number | null;
  restoreFaces: boolean;
  denoisingStrength: number;
}

export interface ComfyUiDefaults {
  promptPrefix: string;
  negativePromptPrefix: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfgScale: number;
  denoisingStrength: number;
  clipSkip: number | null;
  uploadPlaceholderOnMissingReference: boolean;
}

export interface NovelAiDefaults {
  promptPrefix: string;
  negativePromptPrefix: string;
  sampler: string;
  noiseSchedule: string;
  steps: number;
  promptGuidance: number;
  promptGuidanceRescale: number;
  undesiredContentPreset: number;
  /** How strongly character reference images steer the picture (0-1). Higher keeps a character's look closer. */
  referenceStrength: number;
  /** How closely character references are copied (0-1). Lower lets poses and small details loosen up; the look stays. */
  referenceFidelity: number;
}

export interface ImageGenerationDefaultsProfile {
  version: 1;
  service: ImageDefaultsService;
  seed: number;
  styleProfileId: string | null;
  /**
   * Overrides the app's Prompt wording setting for selfies made with this connection. Tag-trained models (Illustrious,
   * Pony, NovelAI) draw long English sentences as text in the picture. Missing = follow the app setting.
   */
  promptWording?: ImagePromptWording;
  automatic1111?: Automatic1111Defaults;
  comfyui?: ComfyUiDefaults;
  novelai?: NovelAiDefaults;
}
