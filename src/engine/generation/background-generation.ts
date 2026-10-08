import type { ImageGenerationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import { normalizeGeneratedImageResult } from "../contracts/generated-image";
import type { AgentResult } from "../contracts/types/agent";
import { parseRecord, readString } from "./runtime-records";

interface BackgroundGenerationRequest {
  location: string;
  prompt: string;
  reason: string;
}

export interface GeneratedBackgroundImage {
  filename: string;
  dataUrl: string;
  mimeType: string;
}

export interface BackgroundGenerationDeps {
  storage: Pick<StorageGateway, "get" | "list">;
  image: Pick<ImageGenerationGateway, "generate"> | null | undefined;
  /** Store the generated image as a background; resolves with the upload record. */
  upload(image: GeneratedBackgroundImage): Promise<unknown>;
  /** Make the uploaded background (its stored filename) the chat's background. */
  applyChoice(chatId: string, chosen: string): Promise<void>;
}

function normalizeBackgroundGenerationRequest(value: unknown): BackgroundGenerationRequest | null {
  const record = parseRecord(value);
  const prompt = readString(record.prompt).trim();
  if (!prompt) return null;
  return {
    location: readString(record.location).trim(),
    prompt,
    reason: readString(record.reason).trim(),
  };
}

function backgroundSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "generated-background"
  );
}

async function defaultAgentImageConnectionId(storage: BackgroundGenerationDeps["storage"]): Promise<string> {
  const connections = await storage.list<Record<string, unknown>>("connections").catch(() => []);
  const defaultConnection = connections.find(
    (item) => readString(item.provider).trim() === "image_generation" && item.defaultForAgents === true,
  );
  return readString(defaultConnection?.id).trim();
}

async function backgroundAgentImageConnectionId(
  chatId: string,
  result: AgentResult,
  storage: BackgroundGenerationDeps["storage"],
): Promise<string> {
  const agentId = readString(result.agentId).trim();
  const direct = agentId ? await storage.get<Record<string, unknown>>("agents", agentId).catch(() => null) : null;
  const fallback = await storage.get<Record<string, unknown>>("agents", "background").catch(() => null);
  const directSettings = parseRecord(direct?.settings);
  const fallbackSettings = parseRecord(fallback?.settings);
  const settingsConnectionId =
    readString(directSettings.imageConnectionId).trim() || readString(fallbackSettings.imageConnectionId).trim();
  if (settingsConnectionId) return settingsConnectionId;

  const chat = await storage.get<Record<string, unknown>>("chats", chatId).catch(() => null);
  const meta = parseRecord(chat?.metadata);
  const chatConnectionId = readString(meta.imageGenConnectionId).trim() || readString(meta.imageConnectionId).trim();
  if (chatConnectionId) return chatConnectionId;

  return defaultAgentImageConnectionId(storage);
}

function uploadedBackgroundChoice(upload: unknown): string {
  const record = parseRecord(upload);
  return (
    readString(record.filename).trim() ||
    readString(record.name).trim() ||
    readString(record.path).trim() ||
    readString(record.url).trim()
  );
}

async function chatHasBackground(storage: BackgroundGenerationDeps["storage"], chatId: string): Promise<boolean> {
  const chat = await storage.get<Record<string, unknown>>("chats", chatId).catch(() => null);
  const metadata = parseRecord(chat?.metadata);
  return !!readString(metadata.background ?? chat?.background).trim();
}

/**
 * Generates the image a Background agent asked for (`data.generate`) and makes it the chat's
 * background, unless the chat already has one (checked again after the slow image call) or no image
 * connection is set. Resolves with the chosen background, or null when nothing was applied.
 */
export async function generateBackgroundForAgentResult(
  chatId: string,
  result: AgentResult,
  deps: BackgroundGenerationDeps,
): Promise<string | null> {
  const request = normalizeBackgroundGenerationRequest(parseRecord(result.data).generate);
  if (!request) return null;
  if (!deps.image) throw new Error("Image generation is not available.");

  if (await chatHasBackground(deps.storage, chatId)) return null;

  const connectionId = await backgroundAgentImageConnectionId(chatId, result, deps.storage);
  if (!connectionId) return null;

  const image = await deps.image.generate({
    connectionId,
    kind: "background",
    reviewId: `background:${chatId}:${backgroundSlug(request.location || request.prompt)}`,
    reviewTitle: request.location ? `Background: ${request.location}` : "Generated background",
    prompt: request.prompt,
    negativePrompt: "people, characters, text, captions, UI, panels, collage",
    width: 1280,
    height: 720,
  });
  const normalizedImage = normalizeGeneratedImageResult(image);
  const imageUrl = normalizedImage.dataUrl;
  if (!imageUrl) throw new Error("Image provider returned no background image data.");
  if (await chatHasBackground(deps.storage, chatId)) return null;

  const upload = await deps.upload({
    filename: `${backgroundSlug(request.location || request.prompt)}.${normalizedImage.ext}`,
    dataUrl: imageUrl,
    mimeType: normalizedImage.mimeType,
  });
  const chosen = uploadedBackgroundChoice(upload);
  if (!chosen) throw new Error("Generated background upload did not return a filename.");
  await deps.applyChoice(chatId, chosen);
  return chosen;
}

export function isBackgroundAgentResult(result: Pick<AgentResult, "agentType" | "type">): boolean {
  return result.type === "background_change" || result.agentType === "background";
}
