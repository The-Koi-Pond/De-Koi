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

export function recordName(record: JsonRecord): string {
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
