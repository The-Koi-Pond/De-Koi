import { importApi } from "../../../../shared/api/import-api";
import { userFacingError } from "../../../../engine/shared/user-facing-error";
import {
  confirmEmbeddedLorebookImport,
  readEmbeddedLorebookFromCharacterPayload,
} from "../../../../shared/lib/character-import";
import { isRecord } from "../../../../engine/shared/value-readers";
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
  /** The detail held for this card; undefined or null when there is none (still loading, none, or failed). */
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

const NOT_A_CARD = "The downloaded file isn't a character card.";

/** The picture type its first bytes say, for PNG, JPEG, GIF and WebP; null for anything else. */
function imageTypeOf(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ascii(0, 4) === "GIF8") return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** The card's picture as a data URL, refusing an empty reply or bytes that aren't a picture. */
async function pictureDataUrl(picture: string): Promise<string> {
  const blob = await fetchBotBrowserAssetBlob(picture);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) throw new Error("the picture came back empty");
  const type = imageTypeOf(bytes);
  if (!type) throw new Error("the picture isn't an image");
  return blobToDataUrl(new Blob([bytes], { type }));
}

/** A reason for a warning: worded errors as they are, anything else as its own message. */
export function warningReason(error: unknown): string {
  const ownMessage = error instanceof Error && error.message ? error.message : String(error ?? "unknown error");
  return toUserMessage(error, { fallback: ownMessage });
}

/** The detail held for the card, else (for providers that do) one fetched now; a fetch that fails means none. */
async function detailForImport(request: BrowserImportRequest): Promise<CharacterDetail | null> {
  if (request.openDetail) return request.openDetail;
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
  let blob: Blob;
  try {
    blob = await fetchSiteBlob(provider.downloadPath(card));
  } catch (error) {
    throw userFacingError(`Couldn't download the character card: ${warningReason(error)}`);
  }
  let parsed: Awaited<ReturnType<typeof parsePngCharacterCard>>;
  try {
    parsed = await parsePngCharacterCard(new File([blob], "character.png", { type: "image/png" }));
  } catch (error) {
    console.warn("[bot-browser] The downloaded card file didn't read as a character card.", error);
    throw userFacingError(NOT_A_CARD);
  }
  // A card's JSON must be an object; a string or a list would spread into nonsense fields.
  const json: unknown = parsed.json;
  if (!isRecord(json)) throw userFacingError(NOT_A_CARD);
  const imageDataUrl = parsed.imageDataUrl;

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
      body._avatarDataUrl = await pictureDataUrl(card.picture);
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
