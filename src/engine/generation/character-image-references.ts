import type { SpriteOwnerType, VisualAssetGateway } from "../capabilities/visual-assets";
import { usableIllustrationReferenceImage } from "../generation-core/images/illustration-reference-selection";
import { parseRecord, readString, type JsonRecord } from "./runtime-records";

/** Where a character's or persona's picture lives, read from its library row. */
export type CharacterImageReferenceSubject = {
  id: string;
  name: string;
  avatar: string;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  spriteOwnerType: SpriteOwnerType;
};

function recordName(record: JsonRecord): string {
  const data = parseRecord(record.data);
  return readString(data.name).trim() || readString(record.name).trim();
}

function recordAvatar(record: JsonRecord): string {
  const data = parseRecord(record.data);
  return readString(
    record.avatarPath ?? record.avatar ?? record.avatarUrl ?? data.avatarPath ?? data.avatar ?? data.avatarUrl,
  ).trim();
}

export function characterImageReferenceSubject(
  record: JsonRecord,
  spriteOwnerType: SpriteOwnerType,
  fallbackId = "",
): CharacterImageReferenceSubject {
  const data = parseRecord(record.data);
  return {
    id: readString(record.id).trim() || fallbackId,
    name: recordName(record),
    avatar: recordAvatar(record),
    avatarFilePath: readString(record.avatarFilePath ?? data.avatarFilePath).trim() || null,
    avatarFilename: readString(record.avatarFilename ?? data.avatarFilename).trim() || null,
    spriteOwnerType,
  };
}

async function resolveReferenceImage(
  visuals: VisualAssetGateway | undefined,
  source: {
    image?: unknown;
    url?: unknown;
    base64?: unknown;
    mimeType?: unknown;
    avatarFilePath?: unknown;
    avatarFilename?: unknown;
  },
): Promise<string> {
  const inline =
    usableIllustrationReferenceImage(source.image) ||
    usableIllustrationReferenceImage(source.url) ||
    usableIllustrationReferenceImage(source.base64);
  if (inline) return inline;
  return (
    (visuals?.resolveReferenceImage
      ? await visuals
          .resolveReferenceImage({
            image: readString(source.image).trim() || null,
            url: readString(source.url).trim() || null,
            base64: readString(source.base64).trim() || null,
            mimeType: readString(source.mimeType).trim() || null,
            avatarFilePath: readString(source.avatarFilePath).trim() || null,
            avatarFilename: readString(source.avatarFilename).trim() || null,
          })
          .catch(() => null)
      : null) ?? ""
  );
}

/** The subject's avatar as an image the provider can take, or "" when it has none. */
export function avatarReferenceImage(
  visuals: VisualAssetGateway | undefined,
  subject: CharacterImageReferenceSubject,
): Promise<string> {
  return resolveReferenceImage(visuals, {
    image: subject.avatar,
    url: subject.avatar,
    avatarFilePath: subject.avatarFilePath,
    avatarFilename: subject.avatarFilename,
  });
}

/** The subject's full-body sprite (full_idle, full_neutral or full_default first), or "" when it has none. */
export async function fullBodySpriteReferenceImage(
  visuals: VisualAssetGateway | undefined,
  subject: CharacterImageReferenceSubject,
): Promise<string> {
  if (!visuals) return "";
  const sprites = (await visuals.listSprites(subject.id, subject.spriteOwnerType).catch(() => [])) as Array<
    Record<string, unknown>
  >;
  const fullBody = sprites.filter((sprite) => readString(sprite.expression).trim().toLowerCase().startsWith("full_"));
  const preferred =
    fullBody.find((sprite) =>
      ["full_idle", "full_neutral", "full_default"].includes(readString(sprite.expression).trim().toLowerCase()),
    ) ?? fullBody[0];
  return preferred ? resolveReferenceImage(visuals, preferred) : "";
}

function promptAlreadyMentionsReferences(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    /\bconsult\b[\s\S]{0,80}\breference/.test(text) ||
    /\b(attached|provided|included)\s+reference/.test(text) ||
    /\breference\s+image/.test(text)
  );
}

/** Tells the image model to keep each named subject's look from the attached references. */
export function appendReferenceGuidance(prompt: string, subjectNames: string[]): string {
  const names = subjectNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return prompt.trim();
  if (promptAlreadyMentionsReferences(prompt)) return prompt.trim();
  const label = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return [
    prompt.trim(),
    `Reference guidance: Consult the attached reference image(s) for ${label} to preserve identity, face, hair, body proportions, and distinctive visible features. Follow the scene prompt for the current outfit, pose, expression, injuries, lighting, and other moment-specific details; scene-specific appearance overrides default reference clothing.`,
  ].join("\n\n");
}

/**
 * NovelAI reads the prompt as tags and draws English sentences into the picture as text; its director references carry
 * the likeness on their own. Same NovelAI detection as the Rust image provider (`infer_image_source`).
 */
export function referenceGuidanceSuitsImageConnection(connection: JsonRecord | null | undefined): boolean {
  if (!connection) return true;
  const source = (readString(connection.imageGenerationSource) || readString(connection.imageService))
    .trim()
    .toLowerCase();
  if (source) return source !== "novelai";
  const model = readString(connection.model).trim().toLowerCase();
  const baseUrl = readString(connection.baseUrl).trim().toLowerCase();
  return !(model.includes("nai-diffusion") || baseUrl.includes("novelai.net"));
}

/**
 * Selfie version: also keeps the references' art style, because a character drawn in another style stops looking like
 * them, and asks for a fresh pose so the model doesn't just redraw the avatar.
 */
export function appendSelfieReferenceGuidance(prompt: string, characterName: string): string {
  const name = characterName.trim() || "the character";
  return [
    prompt.trim(),
    `Reference guidance: The attached reference image(s) show ${name}. Keep ${name}'s identity, face, hair, body proportions, outfit details, and distinctive features, and draw the selfie in the same art style as the references (line work, coloring, face and eye shape), as if the same artist drew it. Ignore anything in the references that is not part of the character, such as app windows, palettes, text, or signatures. Use a new selfie pose and framing from the prompt, not the pose in the references; follow the prompt for the expression, setting, lighting, and any outfit it names.`,
  ].join("\n\n");
}
