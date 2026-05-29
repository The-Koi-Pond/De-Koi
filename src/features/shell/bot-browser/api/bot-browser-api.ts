import { importApi } from "../../../../shared/api/import-api";
import { invokeTauri } from "../../../../shared/api/tauri-client";
import { loadUrlBlob } from "../../../../shared/lib/url-blob";

const TAURI_ASSET_PREFIX = "tauri-api:";

export interface ImportCharacterResult {
  success?: boolean;
  name?: string;
  character?: unknown;
  lorebook?: unknown;
  error?: string;
}

type BinaryPayload =
  | string
  | {
      base64?: string;
      data?: string;
      body?: string;
      mimeType?: string;
      contentType?: string;
      type?: string;
    };

function normalizeBotBrowserPath(path: string): string {
  if (path.startsWith("/bot-browser/")) return path;
  return `/bot-browser/${path.replace(/^\/+/, "")}`;
}

function stripAssetPrefix(src: string): string | null {
  return src.startsWith(TAURI_ASSET_PREFIX) ? src.slice(TAURI_ASSET_PREFIX.length) : null;
}

function binaryStringToBlob(binary: string, mimeType: string): Blob {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function payloadToBlob(payload: BinaryPayload, fallbackMimeType: string): Blob {
  const value = typeof payload === "string" ? payload : payload.base64 ?? payload.data ?? payload.body ?? "";
  const mimeType =
    typeof payload === "string" ? fallbackMimeType : payload.mimeType ?? payload.contentType ?? payload.type ?? fallbackMimeType;

  if (typeof value === "string" && value.startsWith("data:")) {
    const [header, data = ""] = value.split(",", 2);
    const dataMimeType = header.match(/^data:([^;]+)/)?.[1] ?? mimeType;
    return binaryStringToBlob(atob(data), dataMimeType);
  }

  if (typeof value === "string" && value.length > 0) {
    return binaryStringToBlob(atob(value), mimeType);
  }

  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export function botBrowserAssetUrl(path: string): string {
  return `${TAURI_ASSET_PREFIX}${normalizeBotBrowserPath(path)}`;
}

export async function botBrowserGet<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  return invokeTauri<T>("bot_browser_get", { path: normalizeBotBrowserPath(path) });
}

export async function botBrowserPost<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  return invokeTauri<T>("bot_browser_post", { path: normalizeBotBrowserPath(path), body: body ?? null });
}

export async function botBrowserBlob(path: string, fallbackMimeType = "image/png", init?: RequestInit): Promise<Blob> {
  const payload = await botBrowserGet<BinaryPayload>(path, init);
  return payloadToBlob(payload, fallbackMimeType);
}

export async function fetchBotBrowserAssetBlob(
  src: string,
  fallbackMimeType = "image/png",
  init?: RequestInit,
): Promise<Blob> {
  const localPath = stripAssetPrefix(src);
  if (localPath) return botBrowserBlob(localPath, fallbackMimeType, init);

  return loadUrlBlob(src, { init, errorMessage: "Failed to load asset" });
}

export async function resolveBotBrowserAssetUrl(src: string, init?: RequestInit): Promise<string> {
  const localPath = stripAssetPrefix(src);
  if (!localPath) return src;
  const blob = await botBrowserBlob(localPath, "image/png", init);
  return URL.createObjectURL(blob);
}

export async function importStCharacter(body: Record<string, unknown>): Promise<ImportCharacterResult> {
  return importApi.stCharacterJson<ImportCharacterResult>(body);
}
