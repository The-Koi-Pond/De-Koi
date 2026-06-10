type ImageStyleBase =
  | "auto"
  | "anime"
  | "danbooru"
  | "realistic"
  | "photorealistic"
  | "cinematic"
  | "digital_painting"
  | "painterly"
  | "z_image_turbo"
  | "custom";

export type ImagePromptMode = "natural" | "tagged" | "danbooru" | "hybrid";
export type ImagePromptDedupeStrength = "light" | "normal" | "strict";
export type ImagePromptKind = "portrait" | "selfie" | "background" | "illustration" | "sprite" | "avatar";

interface ImageStyleProfileRules {
  dedupeStrength: ImagePromptDedupeStrength;
  preferTagsOverNarrative: boolean;
  preserveUserPhrases: boolean;
}

export interface ImageStyleProfile {
  id: string;
  name: string;
  baseStyle: ImageStyleBase;
  promptMode: ImagePromptMode;
  styleText: string;
  positiveTags: string;
  negativeTags: string;
  subjectTags: Partial<Record<ImagePromptKind, string>>;
  rules: ImageStyleProfileRules;
  builtIn?: boolean;
}

export interface ImageStyleProfileSettings {
  defaultProfileId: string;
  profiles: ImageStyleProfile[];
}

export interface CompiledImagePrompt {
  prompt: string;
  negativePrompt: string;
  profile: ImageStyleProfile;
  diagnostics: {
    removedPositiveDuplicates: string[];
    removedNegativeDuplicates: string[];
    movedNegativeFragments: string[];
  };
}

export interface CompileImagePromptInput {
  kind: ImagePromptKind;
  prompt: string;
  negativePrompt?: string | null;
  styleProfiles: ImageStyleProfileSettings;
  styleProfileId?: string | null;
  generatedStyle?: string | null;
  userPositive?: string | null;
  userNegative?: string | null;
  hardNegative?: string | null;
}

interface PositivePromptPart {
  value: string | null | undefined;
  sourcePrompt: boolean;
  required: boolean;
}

interface PositivePromptFragment {
  value: string;
  required: boolean;
}

const DEFAULT_IMAGE_STYLE_PROFILE_ID = "auto";

const DEFAULT_RULES: ImageStyleProfileRules = {
  dedupeStrength: "normal",
  preferTagsOverNarrative: false,
  preserveUserPhrases: true,
};

const TAGGED_RULES: ImageStyleProfileRules = {
  dedupeStrength: "normal",
  preferTagsOverNarrative: true,
  preserveUserPhrases: true,
};

const DEFAULT_IMAGE_STYLE_PROFILES: ImageStyleProfile[] = [
  {
    id: "auto",
    name: "Auto",
    baseStyle: "auto",
    promptMode: "hybrid",
    styleText: "Infer a consistent visual style from the character, game, scene, and selected image model.",
    positiveTags: "",
    negativeTags: "text, watermark, logo, signature, low quality, blurry",
    subjectTags: {},
    rules: DEFAULT_RULES,
    builtIn: true,
  },
  {
    id: "anime",
    name: "Anime",
    baseStyle: "anime",
    promptMode: "tagged",
    styleText:
      "Anime illustration with clean character design, expressive faces, crisp linework, and polished lighting.",
    positiveTags: "anime style, illustration, best quality, detailed eyes, clean lineart",
    negativeTags: "photorealistic, 3d render, lowres, bad anatomy, bad hands, text, watermark, logo, signature",
    subjectTags: {
      portrait: "solo, portrait, upper body, looking at viewer",
      avatar: "solo, portrait, upper body, centered composition",
      selfie: "solo, selfie, close-up, looking at viewer",
      background: "scenery, environment, no humans",
      illustration: "visual novel CG, cinematic composition, full-frame single scene",
      sprite: "solo, full body, transparent background, visual novel sprite",
    },
    rules: TAGGED_RULES,
    builtIn: true,
  },
  {
    id: "danbooru",
    name: "Danbooru / Illustrious",
    baseStyle: "danbooru",
    promptMode: "danbooru",
    styleText: "Danbooru-tagged anime generation for SDXL, Illustrious, Pony, NovelAI, and similar checkpoints.",
    positiveTags: "masterpiece, best quality, absurdres, anime screencap, detailed eyes",
    negativeTags:
      "worst quality, low quality, lowres, bad anatomy, bad hands, extra digits, fewer digits, text, watermark, logo, signature",
    subjectTags: {
      portrait: "1girl, solo, portrait, upper body, looking at viewer",
      avatar: "solo, portrait, upper body, centered composition",
      selfie: "solo, selfie, close-up, looking at viewer",
      background: "scenery, environment, landscape, no humans",
      illustration: "visual novel CG, cinematic composition, dramatic lighting",
      sprite: "solo, full body, standing, transparent background",
    },
    rules: TAGGED_RULES,
    builtIn: true,
  },
  {
    id: "realistic",
    name: "Realistic SDXL",
    baseStyle: "realistic",
    promptMode: "natural",
    styleText:
      "Realistic SDXL-style image with natural lighting, believable materials, lens-aware composition, and sharp detail.",
    positiveTags: "high quality, realistic, detailed, natural lighting",
    negativeTags: "anime, cartoon, illustration, low quality, blurry, plastic skin, text, watermark, logo, signature",
    subjectTags: {
      portrait: "single subject, portrait, shoulders-up composition",
      avatar: "single subject, centered portrait, readable face",
      selfie: "single subject, casual selfie, natural expression",
      background: "wide environmental shot, no people",
      illustration: "cinematic scene, coherent composition",
      sprite: "single subject, full-body character reference",
    },
    rules: DEFAULT_RULES,
    builtIn: true,
  },
  {
    id: "photorealistic",
    name: "Photorealistic",
    baseStyle: "photorealistic",
    promptMode: "natural",
    styleText:
      "Photorealistic SDXL image with believable skin, optics, materials, camera framing, and natural scene lighting.",
    positiveTags: "photorealistic, high quality, sharp focus, natural lighting, detailed textures",
    negativeTags:
      "anime, cartoon, illustration, painting, plastic skin, uncanny face, low quality, blurry, text, watermark, logo, signature",
    subjectTags: {
      portrait: "single subject, realistic portrait, shoulders-up composition",
      avatar: "single subject, centered face-and-shoulders portrait",
      selfie: "single subject, realistic casual selfie, natural expression",
      background: "real location environment, wide shot, no people",
      illustration: "photoreal cinematic still, coherent scene, clear focal point",
      sprite: "single subject, full-body reference photo, plain background",
    },
    rules: DEFAULT_RULES,
    builtIn: true,
  },
  {
    id: "cinematic",
    name: "Cinematic",
    baseStyle: "cinematic",
    promptMode: "hybrid",
    styleText:
      "Cinematic key art with controlled lighting, strong composition, atmospheric depth, and emotionally clear staging.",
    positiveTags: "cinematic lighting, dramatic composition, atmospheric, high detail",
    negativeTags: "flat lighting, cluttered composition, text, watermark, logo, signature, low quality",
    subjectTags: {
      portrait: "single subject, portrait, expressive face",
      avatar: "single subject, centered portrait",
      selfie: "single subject, close-up, expressive face",
      background: "wide shot, environmental storytelling, no text",
      illustration: "cinematic composition, clear focal point, dramatic lighting",
      sprite: "single subject, readable silhouette",
    },
    rules: DEFAULT_RULES,
    builtIn: true,
  },
  {
    id: "digital-painting",
    name: "Digital Painting",
    baseStyle: "digital_painting",
    promptMode: "hybrid",
    styleText: "Digital painting with refined brushwork, designed lighting, strong silhouettes, and polished detail.",
    positiveTags: "digital painting, concept art, refined brushwork, high detail, designed lighting",
    negativeTags: "photograph, raw photo, muddy details, flat lighting, text, watermark, logo, signature, low quality",
    subjectTags: {
      portrait: "single subject, character portrait, expressive face",
      avatar: "single subject, centered character portrait",
      selfie: "single subject, close-up, painterly expression",
      background: "painted environment, atmospheric scene, no humans",
      illustration: "key art composition, clear focal point, dramatic lighting",
      sprite: "single subject, full-body character concept art",
    },
    rules: DEFAULT_RULES,
    builtIn: true,
  },
  {
    id: "painterly",
    name: "Painterly Fantasy",
    baseStyle: "painterly",
    promptMode: "hybrid",
    styleText: "Painterly fantasy illustration with soft brushwork, rich atmosphere, and storybook color harmony.",
    positiveTags: "painterly, fantasy illustration, soft brushwork, rich atmosphere, high detail",
    negativeTags: "photorealistic, flat colors, muddy details, text, watermark, logo, signature, low quality",
    subjectTags: {
      portrait: "single subject, portrait, painterly character art",
      avatar: "single subject, centered portrait, painterly avatar",
      selfie: "single subject, intimate close-up, painterly lighting",
      background: "fantasy scenery, environment, no humans",
      illustration: "storybook composition, dramatic lighting, clear focal point",
      sprite: "single subject, full-body character art",
    },
    rules: DEFAULT_RULES,
    builtIn: true,
  },
  {
    id: "z-image-turbo",
    name: "Z-Image Turbo Narrative",
    baseStyle: "z_image_turbo",
    promptMode: "natural",
    styleText:
      "Z-Image Turbo prompt that keeps compact narrative expression, coherent subjects, clear composition, and natural visual intent.",
    positiveTags: "",
    negativeTags: "text, watermark, logo, signature, low quality, blurry, malformed hands, distorted face",
    subjectTags: {
      portrait: "A centered portrait with readable expression and clear face-and-shoulders composition.",
      avatar: "A clean avatar portrait with a clear silhouette and readable face.",
      selfie: "A natural close-up selfie with a coherent face, expression, lighting, and background.",
      background: "A coherent environmental image with clear location details and no text.",
      illustration: "A single coherent scene illustration with clear subjects, staging, mood, and lighting.",
      sprite: "A full-body character image with a readable silhouette and clean separation from the background.",
    },
    rules: { ...DEFAULT_RULES, preserveUserPhrases: true },
    builtIn: true,
  },
];

export function createDefaultImageStyleProfileSettings(): ImageStyleProfileSettings {
  return {
    defaultProfileId: DEFAULT_IMAGE_STYLE_PROFILE_ID,
    profiles: DEFAULT_IMAGE_STYLE_PROFILES.map(cloneProfile),
  };
}

export function normalizeImageStyleProfileSettings(raw: unknown): ImageStyleProfileSettings {
  const defaults = createDefaultImageStyleProfileSettings();
  if (!isRecord(raw)) return defaults;

  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const customProfiles = rawProfiles
    .map((profile) => normalizeImageStyleProfile(profile))
    .filter((profile): profile is ImageStyleProfile => !!profile);

  const byId = new Map<string, ImageStyleProfile>();
  for (const profile of defaults.profiles) byId.set(profile.id, profile);
  for (const profile of customProfiles) byId.set(profile.id, profile);

  const profiles = Array.from(byId.values());
  const rawDefaultId = typeof raw.defaultProfileId === "string" ? slugId(raw.defaultProfileId) : defaults.defaultProfileId;
  const defaultProfileId = profiles.some((profile) => profile.id === rawDefaultId)
    ? rawDefaultId
    : defaults.defaultProfileId;

  return { defaultProfileId, profiles };
}

function normalizeImageStyleProfile(raw: unknown): ImageStyleProfile | null {
  if (!isRecord(raw)) return null;
  const id = slugId(readString(raw.id, ""));
  if (!id) return null;

  const fallback = DEFAULT_IMAGE_STYLE_PROFILES.find((profile) => profile.id === id);
  const subjectTags = isRecord(raw.subjectTags) ? raw.subjectTags : {};

  return {
    id,
    name: readString(raw.name, fallback?.name ?? titleFromId(id)).slice(0, 80),
    baseStyle: readEnum(
      raw.baseStyle,
      [
        "auto",
        "anime",
        "danbooru",
        "realistic",
        "photorealistic",
        "cinematic",
        "digital_painting",
        "painterly",
        "z_image_turbo",
        "custom",
      ],
      fallback?.baseStyle ?? "custom",
    ),
    promptMode: readEnum(raw.promptMode, ["natural", "tagged", "danbooru", "hybrid"], fallback?.promptMode ?? "hybrid"),
    styleText: readString(raw.styleText, fallback?.styleText ?? "").slice(0, 2000),
    positiveTags: readString(raw.positiveTags, fallback?.positiveTags ?? "").slice(0, 4000),
    negativeTags: readString(raw.negativeTags, fallback?.negativeTags ?? "").slice(0, 4000),
    subjectTags: normalizeSubjectTags(subjectTags, fallback?.subjectTags),
    rules: normalizeRules(raw.rules, fallback?.rules ?? DEFAULT_RULES),
    builtIn: readBoolean(raw.builtIn, fallback?.builtIn ?? false),
  };
}

export function findImageStyleProfile(
  settings: ImageStyleProfileSettings,
  profileId: string | null | undefined,
): ImageStyleProfile {
  const defaultId = slugId(settings.defaultProfileId || DEFAULT_IMAGE_STYLE_PROFILE_ID) || DEFAULT_IMAGE_STYLE_PROFILE_ID;
  const rawId = profileId?.trim();
  const id = rawId ? slugId(rawId) : defaultId;
  return (
    settings.profiles.find((profile) => profile.id === id) ??
    settings.profiles.find((profile) => profile.id === defaultId) ??
    settings.profiles.find((profile) => profile.id === DEFAULT_IMAGE_STYLE_PROFILE_ID) ??
    DEFAULT_IMAGE_STYLE_PROFILES[0]!
  );
}

export function compileImagePrompt(input: CompileImagePromptInput): CompiledImagePrompt {
  const profile = findImageStyleProfile(
    input.styleProfiles,
    input.styleProfileId || input.styleProfiles.defaultProfileId,
  );
  const promptMode = profile.promptMode;
  const positiveDiagnostics: string[] = [];
  const negativeDiagnostics: string[] = [];
  const movedNegativeFragments: string[] = [];

  const generatedStyle = input.generatedStyle?.trim() ?? "";
  const profileSubjectTags = profile.subjectTags[input.kind] ?? "";
  const compactTags = promptMode === "tagged" || promptMode === "danbooru";
  const compactVisualPrompt =
    profile.baseStyle !== "z_image_turbo" && ["avatar", "portrait", "selfie", "sprite"].includes(input.kind);
  const compactPrompt = compactTags || compactVisualPrompt;
  const fragmentMode = compactPrompt ? "tagged" : promptMode;
  const profileStyleText =
    compactPrompt || (profile.styleText && generatedStyle)
      ? ""
      : profile.styleText && profile.baseStyle !== "auto"
        ? profile.styleText
        : generatedStyle
          ? ""
          : profile.styleText;

  const positiveParts: PositivePromptPart[] = compactPrompt
    ? [
        { value: generatedStyle, sourcePrompt: true, required: true },
        { value: input.prompt, sourcePrompt: true, required: true },
        { value: input.userPositive, sourcePrompt: false, required: true },
        { value: profileSubjectTags, sourcePrompt: false, required: true },
        { value: profile.positiveTags, sourcePrompt: false, required: false },
      ]
    : [
        { value: profile.positiveTags, sourcePrompt: false, required: false },
        { value: profileSubjectTags, sourcePrompt: false, required: false },
        { value: profileStyleText, sourcePrompt: false, required: false },
        { value: generatedStyle, sourcePrompt: false, required: false },
        { value: input.prompt, sourcePrompt: true, required: true },
        { value: input.userPositive, sourcePrompt: true, required: true },
      ];
  const negativeParts = [profile.negativeTags, input.negativePrompt, input.userNegative, input.hardNegative];
  const positiveFragments: PositivePromptFragment[] = [];
  const negativeFragments: string[] = [];

  for (const part of positiveParts) {
    for (const fragment of splitPromptFragments(part.value, fragmentMode, part.sourcePrompt)) {
      const negative = extractNegativeFragment(fragment);
      if (negative) {
        negativeFragments.push(negative);
        movedNegativeFragments.push(fragment);
      } else {
        positiveFragments.push({ value: cleanPromptFragment(fragment, promptMode), required: part.required });
      }
    }
  }

  for (const part of negativeParts) {
    negativeFragments.push(
      ...splitPromptFragments(part, promptMode).map((fragment) => cleanPromptFragment(fragment, promptMode)),
    );
  }

  const positive = compactPromptFragments(
    dedupePositiveFragments(positiveFragments, profile.rules.dedupeStrength, positiveDiagnostics),
    compactPrompt,
  );
  const negative = dedupeFragments(negativeFragments, profile.rules.dedupeStrength, negativeDiagnostics);

  return {
    prompt: joinFragments(positive, compactPrompt ? "tagged" : promptMode),
    negativePrompt: joinFragments(negative, promptMode),
    profile,
    diagnostics: {
      removedPositiveDuplicates: positiveDiagnostics,
      removedNegativeDuplicates: negativeDiagnostics,
      movedNegativeFragments,
    },
  };
}

function normalizeSubjectTags(
  raw: Record<string, unknown>,
  fallback: Partial<Record<ImagePromptKind, string>> = {},
): Partial<Record<ImagePromptKind, string>> {
  const result: Partial<Record<ImagePromptKind, string>> = {};
  for (const kind of ["portrait", "selfie", "background", "illustration", "sprite", "avatar"] as const) {
    result[kind] = readString(raw[kind], fallback[kind] ?? "").slice(0, 1000);
  }
  return result;
}

function normalizeRules(raw: unknown, fallback: ImageStyleProfileRules): ImageStyleProfileRules {
  const record = isRecord(raw) ? raw : {};
  return {
    dedupeStrength: readEnum(record.dedupeStrength, ["light", "normal", "strict"], fallback.dedupeStrength),
    preferTagsOverNarrative: readBoolean(record.preferTagsOverNarrative, fallback.preferTagsOverNarrative),
    preserveUserPhrases: readBoolean(record.preserveUserPhrases, fallback.preserveUserPhrases),
  };
}

function splitPromptFragments(
  value: string | null | undefined,
  promptMode: ImagePromptMode,
  sourcePrompt = false,
): string[] {
  const text = (value ?? "").trim();
  if (!text) return [];

  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[.!?]\s+(?=(?:avoid|no|without|exclude|do not include|don't include)\b)/gi, "\n")
    .replace(/\b(?:avoid|negative prompt|undesired content)\s*:/gi, "\navoid ")
    .replace(/\b(?:positive prompt|tags?)\s*:/gi, "\n");

  if (promptMode === "natural") {
    return normalized
      .split(/\n+|,(?=\s*(?:avoid|no|without)\b)/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const prepared = sourcePrompt ? distillTaggedPromptSource(normalized) : normalized;
  return prepared
    .split(/[,;\n]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function distillTaggedPromptSource(value: string): string {
  const fragments: string[] = deriveTaggedSourceCues(value);
  for (const raw of value.split(/\n+|(?<=[.!?])\s+/g)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const negative = extractNegativeFragment(sentence);
    if (negative) {
      for (const item of negative.split(/[,;]/g)) {
        const cleanNegative = item.trim();
        if (cleanNegative) fragments.push(`avoid ${cleanNegative}`);
      }
      continue;
    }

    const labeled = sentence.match(/^([A-Za-z][A-Za-z ]{1,32}):\s*(.+)$/);
    if (labeled?.[1] && labeled[2]) {
      fragments.push(...distillLabeledPromptValue(labeled[1], labeled[2]));
      continue;
    }

    const clean = sentence
      .replace(
        /^(?:create|generate|make|draw|depict|render)\s+(?:an?\s+)?(?:polished\s+)?(?:character\s+)?(?:avatar\s+)?(?:portrait|image|picture|illustration|scene)\s+(?:of|for)?\s*/i,
        "",
      )
      .replace(/\bfor\s+[A-Z][\p{L}\p{N}'_-]{1,40}\b/gu, "")
      .replace(/[.!?]+$/g, "")
      .trim();
    const distilled = distillVisualPhrases(clean);
    if (distilled.length > 0) {
      fragments.push(...distilled);
    }
    for (const item of clean.split(/[,;]/g)) {
      const cleanItem = item.trim();
      if (looksLikeNameOnly(cleanItem)) continue;
      const negativeItem = extractNegativeFragment(cleanItem);
      if (negativeItem) {
        fragments.push(cleanItem);
        continue;
      }
      const distilledItem = distillVisualPhrases(cleanItem);
      if (distilledItem.length > 0) {
        fragments.push(...distilledItem);
      } else if (shouldKeepTaggedSourceFragment(cleanItem, true) && looksLikeTagPhrase(cleanItem)) {
        fragments.push(cleanItem);
      }
    }
  }
  return fragments.join(", ");
}

function deriveTaggedSourceCues(value: string): string[] {
  const cues: string[] = [];
  const text = value.toLowerCase();
  if (/\b(?:she|her|hers|woman|female|girl|lady)\b/.test(text)) {
    cues.push("female");
  } else if (/\b(?:he|him|his|man|male|boy|gentleman)\b/.test(text)) {
    cues.push("male");
  }
  return cues;
}

function distillLabeledPromptValue(label: string, value: string): string[] {
  const normalizedLabel = label.trim().toLowerCase();
  const cleanValue = value.replace(/[.!?]+$/g, "").trim();
  if (!cleanValue || /^(?:background|goal|personality|traits|occupation|skills|type|name)$/i.test(normalizedLabel)) {
    return [];
  }
  if (/^(?:appearance|canonical appearance|species|equipment|composition)$/i.test(normalizedLabel)) {
    return cleanValue
      .split(/[,;]|\s+\band\b\s+/gi)
      .map((part) => part.trim())
      .filter((part) => shouldKeepTaggedSourceFragment(part));
  }
  return shouldKeepTaggedSourceFragment(cleanValue, true) ? [cleanValue] : [];
}

function distillVisualPhrases(value: string): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const fragments: string[] = [];
  const text = clean.replace(/\u2013|\u2014/g, ", ");
  const age = text.match(
    /\bin\s+(?:her|his|their)\s+((?:early|mid|late)\s+(?:twenties|thirties|forties|fifties|sixties))\b/i,
  );
  if (age?.[1]) fragments.push(age[1]);
  if (/\btall\b/i.test(text)) fragments.push("tall");
  if (/\bstatuesque\b/i.test(text)) fragments.push("statuesque");

  const hair = text.match(/\b(?:her|his|their)\s+([^,.;]+?\bhair)\b/i);
  if (hair?.[1]) fragments.push(cleanVisualPhrase(hair[1]));
  const bareHair = text.match(/\b([a-z][a-z -]{1,30}\s+hair)\b/i);
  if (!hair && bareHair?.[1]) fragments.push(cleanVisualPhrase(bareHair[1]));
  const eyes = text.match(/\b(?:her|his|their)\s+eyes?\s+(?:are|is)\s+(?:an?\s+)?([^,.;]+)/i);
  if (eyes?.[1]) {
    const eyeDescription = cleanVisualPhrase(eyes[1].replace(/\b(?:piercing|framed by|subtle)\b/gi, ""));
    if (eyeDescription) fragments.push(`${eyeDescription} eyes`);
  }
  const tagLikeEyes = text.match(/\b([a-z][a-z -]{1,30})\s+eyes?\b/i);
  if (!eyes && tagLikeEyes?.[0]) fragments.push(cleanVisualPhrase(tagLikeEyes[0]));

  addIfPresent(fragments, text, /\bsharp cheekbones\b/i, "sharp cheekbones");
  addIfPresent(fragments, text, /\bsmoky makeup\b/i, "smoky makeup");
  addIfPresent(fragments, text, /\bblack blazer\b/i, "black blazer");
  addIfPresent(fragments, text, /\bburgundy blouse\b/i, "burgundy blouse");
  addIfPresent(fragments, text, /\bslim trousers\b/i, "slim trousers");
  addIfPresent(fragments, text, /\bheeled boots\b/i, "heeled boots");
  addIfPresent(fragments, text, /\breading glasses\b/i, "reading glasses");
  addIfPresent(fragments, text, /\bstatement ring\b/i, "statement ring");
  addIfPresent(fragments, text, /\bdark red nails\b/i, "dark red nails");

  return fragments.filter((fragment) => shouldKeepTaggedSourceFragment(fragment));
}

function addIfPresent(fragments: string[], text: string, pattern: RegExp, fragment: string): void {
  if (pattern.test(text)) fragments.push(fragment);
}

function cleanVisualPhrase(value: string): string {
  return value
    .replace(/\b(?:a|an|the|is|are|with|into|and|her|his|their)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[, ]+|[, ]+$/g, "")
    .trim();
}

function looksLikeNameOnly(value: string): boolean {
  return /^[A-Z][\p{L}\p{N}'_-]{1,40}(?:\s+[A-Z][\p{L}\p{N}'_-]{1,40})?$/u.test(value.trim());
}

function looksLikeTagPhrase(value: string): boolean {
  const clean = value.trim();
  if (/\b(?:is|are|was|were|has|have|favors|moves|holds|lends|perches|framing|aware)\b/i.test(clean)) return false;
  return clean.split(/\s+/g).length <= 5;
}

function shouldKeepTaggedSourceFragment(value: string, requireVisualCue = false): boolean {
  const clean = value.trim();
  if (!clean || clean.length > 120) return false;
  if (
    /\b(?:debt|childhood|academy|army|country|refugee|business|district|background|universe|agency|determined|goal|dream|survived|moved|born|build|hope|spells?|uncertain|terms?|eventually|struggles?|managed|opened|enrolled|expelled|tracked)\b/i.test(
      clean,
    )
  ) {
    return false;
  }
  if (/^(?:well|right|and|or|but|yet)$/i.test(clean)) return false;
  if (requireVisualCue && !hasVisualCue(clean)) return false;
  return true;
}

function hasVisualCue(value: string): boolean {
  return /\b(?:female|male|woman|man|girl|boy|adult|human|elf|dwarf|orc|android|robot|twenties|thirties|forties|fifties|sixties|statuesque|hair|eyes?|skin|face|body|petite|tall|short|slim|muscular|scar|freckles|beard|makeup|cheekbones|nails|ring|armor|armour|dress|shirt|blouse|trousers|coat|jacket|blazer|robe|uniform|sword|staff|hat|glasses|boots|portrait|close-up|upper body|face-and-shoulders|full body|centered|looking at viewer|expression|silhouette)\b/i.test(
    value,
  );
}

function compactPromptFragments(fragments: PositivePromptFragment[], compactPrompt: boolean, maxChars = 260): string[] {
  if (!compactPrompt) return fragments.map((fragment) => fragment.value);

  const result: string[] = [];
  let length = 0;

  for (const fragment of fragments.filter((item) => item.required)) {
    result.push(fragment.value);
    length += (length ? 2 : 0) + fragment.value.length;
  }

  for (const fragment of fragments
    .map((fragment, index) => ({ ...fragment, index, priority: compactTagPriority(fragment.value) }))
    .filter((fragment) => !fragment.required)
    .sort((a, b) => a.priority - b.priority || a.index - b.index)) {
    if (isLowPriorityCompactTag(fragment.value) && length > 90) continue;
    const nextLength = length + (result.length ? 2 : 0) + fragment.value.length;
    if (nextLength > maxChars) continue;
    result.push(fragment.value);
    length = nextLength;
  }
  return result;
}

function compactTagPriority(value: string): number {
  const tag = value.trim().toLowerCase();
  if (/^(?:female|male|woman|man|girl|boy|human|elf|dwarf|orc|android|robot|person)$/.test(tag)) return 0;
  if (/\b(?:avatar|face-and-shoulders portrait|shoulders-up composition|centered portrait)\b/.test(tag)) return 1;
  if (/\b(?:hair|eyes?)\b/.test(tag)) return 2;
  if (
    /\b(?:armor|armour|dress|shirt|blouse|trousers|coat|jacket|blazer|robe|uniform|sword|staff|hat|glasses|boots|ring)\b/.test(
      tag,
    )
  ) {
    return 3;
  }
  if (/\b(?:portrait|close-up|upper body|face-and-shoulders|full body|centered|looking at viewer)\b/.test(tag))
    return 4;
  if (/\b(?:photorealistic|anime|cinematic|digital painting|painterly|illustration|realistic)\b/.test(tag)) return 5;
  if (
    /^(?:masterpiece|best quality|high quality|sharp focus|natural lighting|detailed textures|absurdres)$/.test(tag)
  ) {
    return 6;
  }
  return 3;
}

function isLowPriorityCompactTag(value: string): boolean {
  return /^(?:single subject|centered composition|readable expression|clear silhouette|readable face|natural expression|photorealistic|realistic|anime style|cinematic|digital painting|painterly|illustration|sharp focus|natural lighting|detailed textures)$/i.test(
    value.trim(),
  );
}

function extractNegativeFragment(fragment: string): string | null {
  const clean = fragment.trim();
  const match = clean.match(/^(?:avoid|no|without|exclude|do not include|don't include)\s+(.+)$/i);
  if (!match?.[1]) return null;
  const negative = match[1].replace(/[.]+$/g, "").trim();
  if (!negative || !looksLikeImageNegativeFragment(negative)) return null;
  return negative;
}

function looksLikeImageNegativeFragment(value: string): boolean {
  return /\b(?:anime|cartoon|illustration|painting|plastic skin|uncanny|low quality|worst quality|bad quality|blurry|blur|out of focus|text|letters|caption|watermark|logo|signature|bad anatomy|bad hands|extra fingers|fingers|digits|malformed|distorted|lowres|extra limbs?|missing limbs?)\b/i.test(
    value.trim(),
  );
}

function cleanPromptFragment(fragment: string, promptMode: ImagePromptMode): string {
  let clean = fragment
    .replace(/\s+/g, " ")
    .replace(
      /^(?:create|generate|make|draw|depict|render)\s+(?:an?\s+)?(?:image|picture|illustration|portrait|scene)\s+(?:of|for)?\s*/i,
      "",
    )
    .replace(/^(?:image|picture|illustration|portrait|scene)\s+(?:of|for)\s+/i, "")
    .replace(/[.]+$/g, "")
    .trim();

  if (promptMode === "danbooru") clean = clean.replace(/\s+style$/i, " style");
  return clean;
}

function dedupeFragments(fragments: string[], strength: ImagePromptDedupeStrength, diagnostics: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of fragments) {
    const fragment = raw.trim();
    if (!fragment) continue;
    const key = fragmentKey(fragment, strength);
    if (!key) continue;
    if (seen.has(key)) {
      diagnostics.push(fragment);
      continue;
    }
    seen.add(key);
    result.push(fragment);
  }

  return result;
}

function dedupePositiveFragments(
  fragments: PositivePromptFragment[],
  strength: ImagePromptDedupeStrength,
  diagnostics: string[],
): PositivePromptFragment[] {
  const seen = new Set<string>();
  const result: PositivePromptFragment[] = [];

  for (const raw of fragments) {
    const fragment = raw.value.trim();
    if (!fragment) continue;
    const key = fragmentKey(fragment, strength);
    if (!key) continue;
    if (seen.has(key)) {
      diagnostics.push(fragment);
      continue;
    }
    seen.add(key);
    result.push({ value: fragment, required: raw.required });
  }

  return result;
}

function fragmentKey(fragment: string, strength: ImagePromptDedupeStrength): string {
  const base = stripPromptWeight(fragment)
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!base) return "";
  if (strength === "light") return base;

  const alias = tagAlias(base);
  if (alias) return alias;
  if (strength === "strict") return strictAlias(base) ?? base;
  return base;
}

function stripPromptWeight(value: string): string {
  let clean = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const wrapped = clean.match(/^[([{]\s*(.+?)\s*[)\]}]$/);
    if (wrapped?.[1]) {
      clean = wrapped[1].trim();
      changed = true;
    }
  }
  return clean.replace(/: ?[+-]?\d+(?:\.\d+)?$/g, "").trim();
}

function tagAlias(value: string): string | null {
  if (/^(?:best|high|good|excellent) quality$/.test(value)) return "quality_high";
  if (/^(?:low|bad|poor) quality$/.test(value)) return "quality_low";
  if (/^(?:text|letters|caption|captions|subtitle|subtitles)$/.test(value)) return "text_artifacts";
  if (/^(?:watermark|logo|signature)$/.test(value)) return value;
  if (/^(?:blurry|blur|out of focus)$/.test(value)) return "blurry";
  if (/^(?:solo|single subject|one subject)$/.test(value)) return "solo_subject";
  if (/^(?:centered|centered composition|centre composition)$/.test(value)) return "centered_composition";
  if (
    /^(?:centered\s+)?(?:realistic\s+)?(?:avatar\s+)?portrait$/.test(value) ||
    /^(?:centered\s+)?face\s+and\s+shoulders\s+portrait$/.test(value) ||
    /^(?:centered\s+)?shoulders\s+up\s+(?:portrait|composition)$/.test(value) ||
    /^(?:centered\s+)?upper\s+body\s+portrait$/.test(value)
  ) {
    return "centered_portrait_composition";
  }
  return null;
}

function strictAlias(value: string): string | null {
  if (/^(?:masterpiece|best quality|high quality|absurdres|highres)$/.test(value)) return "quality_cluster";
  if (/^(?:portrait|avatar portrait|character portrait)$/.test(value)) return "portrait";
  if (/^(?:upper body|bust shot|shoulders up|shoulders-up composition)$/.test(value)) return "upper_body";
  if (/^(?:looking at viewer|facing viewer|looking toward viewer)$/.test(value)) return "looking_at_viewer";
  return null;
}

function joinFragments(fragments: string[], promptMode: ImagePromptMode): string {
  if (promptMode === "natural") return fragments.join(". ");
  return fragments.join(", ");
}

function cloneProfile(profile: ImageStyleProfile): ImageStyleProfile {
  return { ...profile, subjectTags: { ...profile.subjectTags }, rules: { ...profile.rules } };
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}
