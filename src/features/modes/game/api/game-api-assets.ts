import * as g from "./game-api-support";
import {
  canGenerateSceneIllustration,
  fallbackSceneBackground,
  gameIllustrationTurnNumber,
  generatedAssetSlug,
  generatedUploadBase64,
  generatedImageExt,
  illustrationReferenceData,
  imagePromptSettings,
  imageReviewId,
  imageSize,
  imageUrlFromGeneration,
  npcPortraitDetail,
  promptOverride,
  registeredGameImagePrompt,
  uploadGeneratedAsset,
} from "./game-api-asset-helpers";

export async function previewGeneratedAssets(
  payload: g.GameAssetGenerationPayload,
): Promise<{ items: g.GameImagePromptReviewItem[] }> {
  const record = payload as unknown as Record<string, unknown>;
  const chat = await g.getChat(String(record.chatId));
  const meta = g.chatMeta(chat);
  const setup = g.asRecord(meta.gameSetupConfig);
  const artStyle =
    (typeof record.artStylePrompt === "string" && record.artStylePrompt) ||
    (typeof setup.artStylePrompt === "string" && setup.artStylePrompt) ||
    "";
  const promptSettings = imagePromptSettings(record, meta);
  const items: g.GameImagePromptReviewItem[] = [];
  if (typeof record.backgroundTag === "string" && record.backgroundTag.trim()) {
    const id = imageReviewId("background", record.backgroundTag);
    const defaultPrompt = g.sceneAssetPrompt(
      "background",
      record.backgroundTag,
      record.backgroundTag,
      artStyle,
      promptSettings,
    );
    items.push({
      id,
      kind: "background",
      title: `Background: ${record.backgroundTag}`,
      prompt:
        promptOverride(record, id) ??
        (await registeredGameImagePrompt(g.GAME_BACKGROUND_PROMPT_OVERRIDE, {
          defaultPrompt,
          label: record.backgroundTag,
          detail: record.backgroundTag,
          artStyle,
          promptSettings,
        })),
      negativePrompt: g.compiledSceneAssetNegativePrompt("background", promptSettings),
      width: imageSize(record, "background", "width", 1280),
      height: imageSize(record, "background", "height", 720),
    });
  }
  const illustration = g.asRecord(record.illustration);
  const hasIllustrationRequest = Object.keys(illustration).length > 0;
  const illustrationAllowed =
    hasIllustrationRequest &&
    canGenerateSceneIllustration(meta, await gameIllustrationTurnNumber(String(record.chatId)));
  if (illustrationAllowed) {
    const label =
      (typeof illustration.reason === "string" && illustration.reason) ||
      (typeof illustration.slug === "string" && illustration.slug) ||
      (typeof illustration.prompt === "string" && illustration.prompt) ||
      "Scene illustration";
    const id = imageReviewId("illustration", label);
    const detail = String(illustration.prompt ?? label);
    const defaultPrompt = g.sceneAssetPrompt("illustration", label, detail, artStyle, promptSettings);
    const referenceData = await illustrationReferenceData({ chat, meta, illustration });
    items.push({
      id,
      kind: "illustration",
      title: `Illustration: ${label}`,
      prompt:
        promptOverride(record, id) ??
        (await registeredGameImagePrompt(g.GAME_ILLUSTRATION_PROMPT_OVERRIDE, {
          defaultPrompt,
          label,
          detail,
          artStyle,
          promptSettings,
        })),
      negativePrompt: g.compiledSceneAssetNegativePrompt("illustration", promptSettings),
      width: imageSize(record, "illustration", "width", 1280),
      height: imageSize(record, "illustration", "height", 720),
      referenceImages: referenceData.referenceImages,
      referenceSubjectNames: referenceData.referenceSubjectNames,
    });
  }
  const npcs = Array.isArray(record.npcsNeedingAvatars) ? record.npcsNeedingAvatars : [];
  for (const npc of npcs.slice(0, 10)) {
    const npcRecord = g.asRecord(npc);
    const name = g.readTrimmed(npcRecord.name) || "NPC";
    const detail = npcPortraitDetail(npcRecord);
    const id = imageReviewId("portrait", name);
    const defaultPrompt = g.sceneAssetPrompt("portrait", name, detail, artStyle, promptSettings);
    items.push({
      id,
      kind: "portrait",
      title: `Portrait: ${name}`,
      prompt:
        promptOverride(record, id) ??
        (await registeredGameImagePrompt(g.GAME_PORTRAIT_PROMPT_OVERRIDE, {
          defaultPrompt,
          label: name,
          detail,
          artStyle,
          promptSettings,
        })),
      negativePrompt: g.compiledSceneAssetNegativePrompt("portrait", promptSettings),
      width: imageSize(record, "portrait", "width", 768),
      height: imageSize(record, "portrait", "height", 1024),
    });
  }
  return { items };
}

export async function generateAssets(
  payload: g.GameAssetGenerationPayload,
  signal?: AbortSignal,
): Promise<g.GameAssetGenerationResult> {
  const record = payload as unknown as Record<string, unknown>;
  const chatId = String(record.chatId);
  const chat = await g.getChat(chatId);
  const meta = g.chatMeta(chat);
  let sessionChat = chat;
  if (!meta.enableSpriteGeneration) {
    return {
      generatedBackground: null,
      fallbackBackground: null,
      generatedIllustration: null,
      generatedNpcAvatars: [],
      sessionChat,
    };
  }
  const imageConnectionId =
    (typeof record.imageConnectionId === "string" && record.imageConnectionId) ||
    (typeof meta.gameImageConnectionId === "string" && meta.gameImageConnectionId) ||
    (typeof meta.imageConnectionId === "string" && meta.imageConnectionId) ||
    (typeof g.asRecord(meta.gameSetupConfig).imageConnectionId === "string" &&
      (g.asRecord(meta.gameSetupConfig).imageConnectionId as string));
  if (!imageConnectionId) throw new Error("Game image generation requires an image connection.");

  const preview = await previewGeneratedAssets(payload);
  let generatedBackground: string | null = null;
  let fallbackBackground: string | null = null;
  let generatedIllustration: g.GameAssetGenerationResult["generatedIllustration"] = null;
  const generatedNpcAvatars: g.GameAssetGenerationResult["generatedNpcAvatars"] = [];

  for (const item of preview.items) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    let image: { base64: string; mimeType: string; image?: string; ext?: string; provider?: string; model?: string };
    try {
      image = await g.imageGenerationApi.generate<{
        base64: string;
        mimeType: string;
        image?: string;
        ext?: string;
        provider?: string;
        model?: string;
      }>(g.gameImageGenerationRequest(imageConnectionId, item));
    } catch (error) {
      if (item.kind === "background") {
        fallbackBackground = fallbackSceneBackground(meta);
        if (fallbackBackground) continue;
      }
      throw error;
    }
    if (item.kind === "background") {
      const key = typeof record.backgroundTag === "string" ? record.backgroundTag : "generated-background";
      const tag = await uploadGeneratedAsset(
        "backgrounds",
        "generated",
        generatedAssetSlug(key),
        generatedUploadBase64(image, "background upload"),
        image.mimeType,
        image.ext,
      );
      generatedBackground = tag;
      sessionChat = await g.patchChatMetadata(chatId, { gameSceneBackground: tag });
    } else if (item.kind === "illustration") {
      const illustrationTurnNumber = await gameIllustrationTurnNumber(chatId);
      const illustration = g.asRecord(record.illustration);
      const key = (typeof illustration.slug === "string" && illustration.slug) || item.title || "scene-illustration";
      const tag = await uploadGeneratedAsset(
        "backgrounds",
        "illustrations",
        generatedAssetSlug(key),
        generatedUploadBase64(image, "illustration upload"),
        image.mimeType,
        image.ext,
      );
      generatedIllustration = {
        tag,
        ...(Number.isInteger(illustration.segment) ? { segment: illustration.segment as number } : {}),
      };
      const mimeType = image.mimeType || "image/png";
      const imageUrl = imageUrlFromGeneration(image);
      const filename = `${generatedAssetSlug(key)}.${generatedImageExt(image.ext, mimeType)}`;
      const gallery = await g.storageApi.create<{ id?: string }>("gallery", {
        chatId,
        filePath: filename,
        filename,
        url: imageUrl,
        prompt: item.prompt,
        provider: image.provider ?? "image_generation",
        model: image.model ?? null,
        width: item.width,
        height: item.height,
        kind: "illustration",
        characters: item.referenceSubjectNames?.length
          ? item.referenceSubjectNames
          : g.stringArray(illustration.characters),
        referenceImageCount: item.referenceImages?.length ?? 0,
        gameAssetTag: tag,
      });
      generatedIllustration.galleryId = gallery?.id ?? null;
      sessionChat = await g.patchChatMetadata(chatId, {
        gameLastIllustrationTurn: illustrationTurnNumber,
        gameLastIllustrationSessionNumber: Number(meta.gameSessionNumber ?? 1),
        gameLastIllustrationTag: tag,
      });
    } else if (item.kind === "portrait") {
      const npcName = g.readTrimmed(item.title.replace(/^Portrait:\s*/, "")) || "NPC";
      const mimeType = image.mimeType || "image/png";
      const imageUrl = imageUrlFromGeneration(image);
      if (!imageUrl) throw new Error("Image provider returned no image data.");
      const filename = `${generatedAssetSlug(npcName)}.${generatedImageExt(image.ext, mimeType)}`;
      const gallery = await g.storageApi.create<{ id?: string; url?: string }>("gallery", {
        chatId,
        filePath: filename,
        filename,
        url: imageUrl,
        prompt: item.prompt,
        provider: image.provider ?? "image_generation",
        model: image.model ?? null,
        width: item.width,
        height: item.height,
        kind: "portrait",
        characters: [npcName],
      });
      const storedImageUrl = g.readTrimmed(gallery?.url) || imageUrl;
      const avatarGalleryId = g.readTrimmed(gallery?.id) || null;
      generatedNpcAvatars.push({
        name: npcName,
        avatarUrl: storedImageUrl,
        avatarGalleryId,
      });
    }
  }

  if (generatedNpcAvatars.length > 0) {
    const freshMeta = g.chatMeta(await g.getChat(chatId));
    const npcs = Array.isArray(freshMeta.gameNpcs) ? [...(freshMeta.gameNpcs as g.GameNpc[])] : [];
    for (const avatar of generatedNpcAvatars) {
      const existing = npcs.find((npc) => g.readTrimmed(npc.name).toLowerCase() === avatar.name.toLowerCase());
      if (existing) {
        existing.avatarUrl = avatar.avatarUrl;
        existing.avatarGalleryId = avatar.avatarGalleryId ?? null;
      } else {
        npcs.push({
          id: g.newId("npc"),
          emoji: "👤",
          name: avatar.name,
          description: "",
          location: "",
          reputation: 0,
          met: true,
          notes: [],
          avatarUrl: avatar.avatarUrl,
          avatarGalleryId: avatar.avatarGalleryId ?? null,
        } as g.GameNpc);
      }
    }
    sessionChat = await g.patchChatMetadata(chatId, { gameNpcs: npcs });
  }

  return { generatedBackground, fallbackBackground, generatedIllustration, generatedNpcAvatars, sessionChat };
}
