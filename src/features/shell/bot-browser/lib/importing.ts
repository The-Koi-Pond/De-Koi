import { importApi } from "../../../../shared/api/import-api";
import { userFacingError } from "../../../../engine/shared/user-facing-error";
import {
  confirmEmbeddedLorebookImport,
  readEmbeddedLorebookFromCharacterPayload,
} from "../../../../shared/lib/character-import";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { parsePngCharacterCard } from "../../../../shared/lib/png-parser";
import { blobToDataUrl } from "../../../../shared/lib/url-blob";
import { botBrowserSource, buildCardFields } from "./card-fields";
import { mergeCharacterDetailIntoCharacterJson } from "./character-detail-merge";
import type { BrowserCard, BrowserProvider, CharacterDetail } from "./providers/types";
import { fetchBotBrowserAssetBlob, fetchSiteBlob } from "./site-api";

export type TagImportMode = "all" | "none" | "existing";

/** What `import_st_character` answers; the screen reads only these fields. */
interface BotBrowserImportResult {
  success?: boolean;
  characterId?: string;
  name?: string;
  filename?: string;
  character?: { id?: string; data?: Record<string, unknown> } | null;
  lorebook?: { lorebookId?: string } | null;
  embeddedLorebook?: {
    hasEmbeddedLorebook?: boolean;
    entries?: number;
    imported?: boolean;
    skipped?: boolean;
  } | null;
  error?: string;
}

export interface BrowserImportRequest {
  provider: BrowserProvider;
  card: BrowserCard;
  /** The detail shown for this card: undefined when it hasn't arrived, null when the site had none. */
  openDetail: CharacterDetail | null | undefined;
  tagImportMode: TagImportMode;
}

export interface BrowserImportOutcome {
  result: BotBrowserImportResult;
  /** The imported character's name for the success toast. */
  name: string;
  /** Things the import left out, said after it succeeds. */
  warnings: string[];
}

/** A reason for a warning: worded errors as they are, anything else as its own message. */
export function warningReason(error: unknown): string {
  const ownMessage = error instanceof Error && error.message ? error.message : String(error ?? "unknown error");
  return toUserMessage(error, { fallback: ownMessage });
}

async function detailForImport(request: BrowserImportRequest): Promise<CharacterDetail | null> {
  if (request.openDetail !== undefined) return request.openDetail;
  if (!request.provider.importFetchesDetail) return null;
  try {
    return await request.provider.fetchDetail(request.card);
  } catch (error) {
    // A detail that won't load doesn't stop the import; the card comes in with what the site's search gave.
    console.warn("[bot-browser] Importing without the character's detail.", error);
    return null;
  }
}

async function pngImportBody(request: BrowserImportRequest): Promise<Record<string, unknown>> {
  const { provider, card, tagImportMode } = request;
  if (!provider.downloadPath) throw new Error(`${provider.name} has no card file to download.`);
  const blob = await fetchSiteBlob(provider.downloadPath(card));
  const file = new File([blob], "character.png", { type: "image/png" });
  const { json, imageDataUrl } = await parsePngCharacterCard(file);

  const detail = await detailForImport(request);
  const merged = detail
    ? mergeCharacterDetailIntoCharacterJson(json, {
        ...detail,
        name: card.name,
        creator: card.creator,
        tags: card.tags,
      })
    : json;
  const importEmbeddedLorebook = await confirmEmbeddedLorebookImport(
    card.name,
    detail?.embeddedLorebook ?? readEmbeddedLorebookFromCharacterPayload(merged),
  );
  return {
    ...merged,
    _avatarDataUrl: imageDataUrl,
    _botBrowserSource: botBrowserSource(provider.id, card),
    importEmbeddedLorebook,
    tagImportMode,
  };
}

async function builtImportBody(request: BrowserImportRequest, warnings: string[]): Promise<Record<string, unknown>> {
  const { provider, card, tagImportMode } = request;
  const detail = await detailForImport(request);
  const importEmbeddedLorebook = await confirmEmbeddedLorebookImport(card.name, detail?.embeddedLorebook);
  const body: Record<string, unknown> = {
    ...buildCardFields(provider.id, card, detail),
    _botBrowserSource: botBrowserSource(provider.id, card),
    tagImportMode,
    importEmbeddedLorebook,
  };
  if (card.picture) {
    try {
      body._avatarDataUrl = await blobToDataUrl(await fetchBotBrowserAssetBlob(card.picture));
    } catch (error) {
      warnings.push(`Imported without its picture: ${warningReason(error)}`);
    }
  }
  return body;
}

/**
 * Imports one character: ChubAI and CharacterTavern bring the site's own card PNG (merged with the detail), the
 * others build a card from the detail. Throws when the importer refuses.
 */
export async function importBrowserCharacter(request: BrowserImportRequest): Promise<BrowserImportOutcome> {
  const warnings: string[] = [];
  const isPng = request.provider.importKind === "png";
  const body = isPng ? await pngImportBody(request) : await builtImportBody(request, warnings);
  const result = await importApi.stCharacterJson<BotBrowserImportResult>(body);
  if (!result?.success) throw userFacingError(result?.error || "Import failed");
  return { result, name: result.name || (isPng ? "character" : request.card.name), warnings };
}
