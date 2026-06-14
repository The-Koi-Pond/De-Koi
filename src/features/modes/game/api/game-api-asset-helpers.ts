import * as g from "./game-api-support";

export function generatedAssetSlug(value: string): string {
  const slug = deterministicAssetSlug(value);
  return slug || `generated-${Date.now()}`;
}

function deterministicAssetSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function imageReviewId(kind: string, key: string): string {
  return `${kind}:${deterministicAssetSlug(key) || "generated"}`;
}

export function promptOverride(payload: Record<string, unknown>, id: string): string | null {
  const overrides = Array.isArray(payload.promptOverrides) ? (payload.promptOverrides as g.PromptOverride[]) : [];
  const override = overrides.find((item) => item.id === id && typeof item.prompt === "string" && item.prompt.trim());
  return override?.prompt?.trim() ?? null;
}

export function imageSize(
  payload: Record<string, unknown>,
  bucket: string,
  axis: "width" | "height",
  fallback: number,
): number {
  const bucketSize = g.asRecord(g.asRecord(payload.imageSizes)[bucket]);
  const value = Number(bucketSize[axis]);
  return Number.isFinite(value) && value >= 128 && value <= 4096 ? value : fallback;
}

function imageStyleProfileIdFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function imagePromptSettings(
  payload: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): g.ImagePromptSettings {
  const raw = g.asRecord(payload.imagePromptSettings);
  const setup = g.asRecord(meta.gameSetupConfig);
  return {
    includeAppearances: raw.includeAppearances !== false,
    format: raw.format === "tags" ? "tags" : "descriptive",
    styleProfileId:
      imageStyleProfileIdFrom(raw.styleProfileId) ??
      imageStyleProfileIdFrom(setup.imageStyleProfileId) ??
      imageStyleProfileIdFrom(meta.imageStyleProfileId) ??
      imageStyleProfileIdFrom(meta.gameImageStyleProfileId),
    styleProfiles:
      raw.styleProfiles && typeof raw.styleProfiles === "object" && !Array.isArray(raw.styleProfiles)
        ? (raw.styleProfiles as g.ImageStyleProfileSettings)
        : undefined,
  };
}

function npcPortraitDetail(npc: Record<string, unknown>): string {
  const parts: string[] = [];
  const gender = g.readTrimmed(npc.gender);
  const pronouns = g.readTrimmed(npc.pronouns);
  const location = g.readTrimmed(npc.location);
  const description = g.readTrimmed(npc.description);
  const notes = g.stringArray(npc.notes).slice(0, 6);
  if (gender) parts.push(`Gender: ${gender}.`);
  if (pronouns) parts.push(`Pronouns: ${pronouns}.`);
  if (location) parts.push(`Location: ${location}.`);
  if (notes.length > 0) parts.push(`Notes: ${notes.join("; ")}.`);
  if (description) parts.push(description);
  return parts.join(" ").trim() || "distinctive character portrait";
}

export function promptDetail(parts: Array<string | null | undefined>): string {
  return parts.map((part) => g.readTrimmed(part).replace(/\s+/g, " ")).filter(Boolean).join(" ");
}

function promptLine(label: string, value: unknown): string | null {
  const text = g.readTrimmed(value).replace(/\s+/g, " ");
  return text ? `${label}: ${text}.` : null;
}

export function scenePromptContext(meta: Record<string, unknown>, payload: Record<string, unknown>): string {
  const setup = g.asRecord(meta.gameSetupConfig);
  const map = g.asRecord(meta.gameMap);
  const lines = [
    promptLine("World overview", meta.gameWorldOverview ?? setup.worldOverview),
    promptLine("Genre", setup.genre),
    promptLine("Setting", setup.setting),
    promptLine("Current location", payload.currentLocation ?? payload.location ?? map.name),
    promptLine("Location detail", map.description),
    promptLine("Weather", payload.weather ?? payload.currentWeather ?? meta.gameWeather),
    promptLine("Time of day", payload.timeOfDay ?? payload.currentTimeOfDay ?? meta.gameTimeFormatted),
  ].filter((line): line is string => !!line);
  return lines.length > 0 ? `Scene context: ${lines.join(" ")}` : "";
}

export function imagePromptInstructions(meta: Record<string, unknown>, payload: Record<string, unknown>): string {
  return g.readTrimmed(payload.imagePromptInstructions ?? meta.gameImagePromptInstructions).replace(/\s+/g, " ");
}

function normalizedNpcName(value: unknown): string {
  return g.readTrimmed(value).toLowerCase();
}

export function matchingGameNpc(meta: Record<string, unknown>, name: string): Record<string, unknown> {
  const normalized = normalizedNpcName(name);
  if (!normalized || !Array.isArray(meta.gameNpcs)) return {};
  return g.asRecord(meta.gameNpcs.find((npc) => normalizedNpcName(g.asRecord(npc).name) === normalized));
}

function firstTrimmed(...values: unknown[]): string {
  for (const value of values) {
    const text = g.readTrimmed(value);
    if (text) return text;
  }
  return "";
}

function firstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const items = g.stringArray(value);
    if (items.length > 0) return items;
  }
  return [];
}

export function npcPortraitDetailFromContext(npc: Record<string, unknown>, meta: Record<string, unknown>): string {
  const name = g.readTrimmed(npc.name);
  const storedNpc = matchingGameNpc(meta, name);
  return npcPortraitDetail({
    name: firstTrimmed(npc.name, storedNpc.name),
    gender: firstTrimmed(npc.gender, storedNpc.gender),
    pronouns: firstTrimmed(npc.pronouns, storedNpc.pronouns),
    location: firstTrimmed(npc.location, storedNpc.location),
    notes: firstStringArray(npc.notes, storedNpc.notes),
    description: firstTrimmed(npc.description, storedNpc.description),
  });
}

export function illustrationCharacterDescriptions(
  illustration: Record<string, unknown>,
  meta: Record<string, unknown>,
): string {
  const lines: string[] = [];
  for (const description of g.stringArray(illustration.characterDescriptions)) {
    lines.push(description);
  }
  for (const name of g.stringArray(illustration.characters)) {
    const npc = matchingGameNpc(meta, name);
    const detail = npcPortraitDetail(npc);
    if (detail && detail !== "distinctive character portrait") lines.push(`${name}: ${detail}`);
  }
  return lines.length > 0 ? `Visible characters: ${lines.join(" ")}` : "";
}

export async function registeredGameImagePrompt(
  definition: g.PromptOverrideKeyDef<g.ImagePromptOverrideContext>,
  input: {
    defaultPrompt: string;
    label: string;
    detail: string;
    artStyle: string;
    promptSettings: g.ImagePromptSettings;
    context?: Record<string, string | number | undefined>;
  },
): Promise<string> {
  return g.loadRegisteredPrompt(g.storageApi, definition, {
    defaultPrompt: input.defaultPrompt,
    label: input.label,
    detail: input.detail,
    artStyle: input.artStyle,
    format: input.promptSettings.format ?? "descriptive",
    includeAppearances: String(input.promptSettings.includeAppearances !== false),
    ...input.context,
  });
}

function assetTagFromPath(path: string): string {
  return path.replace(/\.[^.]+$/, "").replace(/[\\/]/g, ":");
}

function imageExt(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "jpg";
}

export function generatedImageExt(ext: unknown, mimeType: string): string {
  const normalized = g.readTrimmed(ext).toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(normalized)) {
    return normalized === "jpeg" ? "jpg" : normalized;
  }
  return imageExt(mimeType);
}

function base64File(base64: string, name: string, type: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
}

const GAME_SCENE_ILLUSTRATION_COOLDOWN_TURNS = 8;

function usableReferenceImage(value: unknown): string {
  const text = g.readTrimmed(value);
  if (!text) return "";
  if (text.startsWith("data:image/")) return text;
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s+/g, "").length > 80) return text;
  return "";
}

function isManagedLocalAssetUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://asset.localhost/") || normalized.startsWith("asset://localhost/");
}

function isBrowserFetchableImageReferenceUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("blob:");
}

function isRemoteImageReferenceUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image reference data."));
    reader.readAsDataURL(blob);
  });
}

async function blobImageReferenceDataUrl(value: string): Promise<string> {
  const response = await fetch(value);
  if (!response.ok) return "";
  const blob = await response.blob();
  if (blob.type && !blob.type.toLowerCase().startsWith("image/")) return "";
  return blobToDataUrl(blob);
}

async function managedImageReferenceDataUrl(value: string, allowResolvedUrl = false): Promise<string> {
  if (allowResolvedUrl && isBrowserFetchableImageReferenceUrl(value)) return blobImageReferenceDataUrl(value);
  if (!isManagedLocalAssetUrl(value) && !(allowResolvedUrl && isRemoteImageReferenceUrl(value))) return "";
  const blob = await g.urlBinaryApi.load(value, "image/png");
  if (blob.type && !blob.type.toLowerCase().startsWith("image/")) return "";
  return blobToDataUrl(blob);
}

async function providerReferenceImage(value: unknown, allowResolvedUrl = false): Promise<string> {
  const direct = usableReferenceImage(value);
  if (direct) return direct;
  const text = g.readTrimmed(value);
  if (!text) return "";
  return managedImageReferenceDataUrl(text, allowResolvedUrl).catch(() => "");
}

async function galleryReferenceImage(galleryId: unknown): Promise<string> {
  const id = g.readTrimmed(galleryId);
  if (!id) return "";
  const gallery = await g.storageApi.get<Record<string, unknown>>("gallery", id).catch(() => null);
  if (!gallery) return "";
  const direct = await providerReferenceImage(gallery.url);
  if (direct) return direct;
  const resolved = await g
    .resolveGalleryFileUrl(g.readTrimmed(gallery.filename), g.readTrimmed(gallery.filePath))
    .catch(() => null);
  return resolved ? providerReferenceImage(resolved, true) : "";
}

async function firstProviderReferenceImage(values: unknown[]): Promise<string> {
  for (const value of values) {
    const reference = await providerReferenceImage(value);
    if (reference) return reference;
  }
  return "";
}

async function npcReferenceImage(npc: Record<string, unknown>): Promise<string> {
  const direct = await firstProviderReferenceImage([npc.avatarUrl, npc.avatar, npc.image]);
  return direct || galleryReferenceImage(npc.avatarGalleryId ?? npc.galleryId);
}

async function recordReferenceImage(record: Record<string, unknown>): Promise<string> {
  const data = g.asRecord(record.data);
  return firstProviderReferenceImage([
    record.avatarPath,
    record.avatar,
    record.avatarUrl,
    data.avatarPath,
    data.avatar,
    data.avatarUrl,
  ]);
}

function matchesIllustrationSubject(
  subject: g.IllustrationReferenceSubject,
  illustration: Record<string, unknown>,
): boolean {
  const name = subject.name.toLowerCase();
  if (!name) return false;
  const requestedNames = g.stringArray(illustration.characters).map((entry) => entry.toLowerCase());
  if (requestedNames.length > 0) {
    return requestedNames.some(
      (requested) => requested === name || requested.includes(name) || name.includes(requested),
    );
  }
  const prompt = g.readTrimmed(illustration.prompt).toLowerCase();
  if (prompt.includes(name)) return true;
  return name
    .split(/\s+/)
    .filter((part) => part.length > 2)
    .some((part) => prompt.includes(part));
}

async function fullBodySpriteReference(sprites: Array<Record<string, unknown>>): Promise<string> {
  const fullBody = sprites.filter((sprite) => g.readTrimmed(sprite.expression).toLowerCase().startsWith("full_"));
  const preferred =
    fullBody.find((sprite) =>
      ["full_idle", "full_neutral", "full_default"].includes(g.readTrimmed(sprite.expression).toLowerCase()),
    ) ?? fullBody[0];
  return preferred ? firstProviderReferenceImage([preferred.url, preferred.image, preferred.base64]) : "";
}

export async function gameIllustrationTurnNumber(chatId: string): Promise<number> {
  const messages = await g.listMessages(chatId).catch(() => []);
  if (!Array.isArray(messages)) return 0;
  return messages.filter((message) => message.role === "assistant" || message.role === "narrator").length;
}

export function canGenerateSceneIllustration(meta: Record<string, unknown>, turnNumber: number): boolean {
  const sessionNumber = Number(meta.gameSessionNumber ?? 1);
  const lastSessionNumber = Number(meta.gameLastIllustrationSessionNumber ?? Number.NaN);
  const lastTurnNumber = Number(meta.gameLastIllustrationTurn ?? Number.NaN);
  if (!Number.isFinite(lastSessionNumber) || !Number.isFinite(lastTurnNumber)) return true;
  if (lastSessionNumber !== sessionNumber) return true;
  return turnNumber - lastTurnNumber >= GAME_SCENE_ILLUSTRATION_COOLDOWN_TURNS;
}

async function loadIllustrationReferenceSubjects(
  chat: g.Chat,
  meta: Record<string, unknown>,
): Promise<g.IllustrationReferenceSubject[]> {
  const characterRows = await Promise.all(
    (Array.isArray(chat.characterIds) ? chat.characterIds : []).map((id) =>
      g.storageApi.get<Record<string, unknown>>("characters", id).catch(() => null),
    ),
  );
  const subjects: g.IllustrationReferenceSubject[] = await Promise.all(
    characterRows
      .filter((row): row is Record<string, unknown> => !!row)
      .map(async (row) => ({
        id: g.readTrimmed(row.id),
        name: g.recordName(row),
        avatar: await recordReferenceImage(row),
        spriteOwnerType: "character",
      })),
  );

  const personaId = g.readTrimmed(chat.personaId);
  const persona = personaId
    ? await g.storageApi.get<Record<string, unknown>>("personas", personaId).catch(() => null)
    : null;
  if (persona) {
    subjects.push({
      id: personaId || g.readTrimmed(persona.id),
      name: g.recordName(persona),
      avatar: await recordReferenceImage(persona),
      spriteOwnerType: "persona",
    });
  }

  const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as Array<Record<string, unknown>>) : [];
  for (const npc of npcs) {
    const avatar = await npcReferenceImage(npc);
    if (!avatar) continue;
    subjects.push({
      id: g.readTrimmed(npc.id) || g.readTrimmed(npc.name),
      name: g.readTrimmed(npc.name),
      avatar,
    });
  }

  return subjects.filter((subject) => subject.id && subject.name);
}

export async function illustrationReferenceData(args: {
  chat: g.Chat;
  meta: Record<string, unknown>;
  illustration: Record<string, unknown>;
}): Promise<{ referenceImages: string[]; referenceSubjectNames: string[] }> {
  const subjects = await loadIllustrationReferenceSubjects(args.chat, args.meta);
  const referenceImages: string[] = [];
  const referenceSubjectNames: string[] = [];
  for (const subject of subjects.filter((item) => matchesIllustrationSubject(item, args.illustration))) {
    let spriteReference = "";
    if (subject.spriteOwnerType) {
      const sprites = await g.spriteApi
        .list<Array<Record<string, unknown>>>(subject.id, { ownerType: subject.spriteOwnerType })
        .catch(() => []);
      spriteReference = await fullBodySpriteReference(sprites);
    }
    const reference = spriteReference || subject.avatar;
    if (reference && !referenceImages.includes(reference)) referenceImages.push(reference);
    if (reference && !referenceSubjectNames.includes(subject.name)) referenceSubjectNames.push(subject.name);
  }
  return { referenceImages, referenceSubjectNames };
}

export function fallbackSceneBackground(meta: Record<string, unknown>): string | null {
  const background = g.readTrimmed(meta.gameSceneBackground);
  return background && !background.startsWith("backgrounds:illustrations:") ? background : null;
}

export function imageUrlFromGeneration(image: { base64?: string; mimeType?: string; image?: string }): string {
  const direct = g.readTrimmed(image.image);
  if (direct) return direct;
  const base64 = g.readTrimmed(image.base64);
  const mimeType = g.readTrimmed(image.mimeType) || "image/png";
  return base64 ? `data:${mimeType};base64,${base64}` : "";
}

export function generatedUploadBase64(image: { base64?: string }, label: string): string {
  const base64 = g.readTrimmed(image.base64).replace(/\s+/g, "");
  if (!base64) throw new Error(`Image provider returned no base64 data for ${label}.`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error(`Image provider returned invalid base64 data for ${label}.`);
  }
  return base64;
}

export async function uploadGeneratedAsset(
  category: string,
  subcategory: string,
  slug: string,
  base64: string,
  mimeType: string,
  ext?: string,
): Promise<string> {
  const uploaded = (await g.gameAssetsApi.upload({
    category,
    subcategory,
    file: base64File(base64, `${slug}.${generatedImageExt(ext, mimeType)}`, mimeType),
  })) as { item?: { path?: string } };
  const path = uploaded.item?.path;
  if (!path) throw new Error("Generated asset path missing.");
  return assetTagFromPath(path);
}
