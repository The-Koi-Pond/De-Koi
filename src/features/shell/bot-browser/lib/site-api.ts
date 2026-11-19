import { botBrowserCommandApi } from "../../../../shared/api/bot-browser-command-api";
import { isRecord } from "../../../../engine/shared/value-readers";
import { loadUrlBlob } from "../../../../shared/lib/url-blob";

/** A card picture that has to go through Rust: `tauri-api:` followed by a Bot Browser path. */
const PROXY_IMAGE_PREFIX = "tauri-api:";

export function proxyImageSource(path: string): string {
  return `${PROXY_IMAGE_PREFIX}/bot-browser/${path}`;
}

export function siteGet<T>(path: string): Promise<T> {
  return botBrowserCommandApi.get<T>(path);
}

export function sitePost<T>(path: string, body?: unknown): Promise<T> {
  return botBrowserCommandApi.post<T>(path, body);
}

const FALLBACK_MIME_TYPE = "application/octet-stream";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function dataUrlToBlob(url: string, fallbackType: string): Blob {
  const comma = url.indexOf(",");
  const header = comma === -1 ? url : url.slice(0, comma);
  const payload = comma === -1 ? "" : url.slice(comma + 1);
  const ownType = /^data:([^;,]+)/i.exec(header)?.[1];
  const type = ownType || fallbackType;
  if (/;base64$/i.test(header)) return new Blob([base64ToBytes(payload)], { type });
  return new Blob([decodeURIComponent(payload)], { type });
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function bytesToBlob(bytes: string, type: string): Blob {
  if (bytes.startsWith("data:")) return dataUrlToBlob(bytes, type);
  return new Blob([base64ToBytes(bytes)], { type });
}

/**
 * Turns a binary reply into a Blob. Rust sends `{ base64, mimeType }`; `data`, `body` or a plain string also carry
 * the bytes, `contentType` or `type` the type, and a `data:` URL in any of them brings its own type. Anything else
 * is JSON text.
 */
export function binaryReplyToBlob(reply: unknown): Blob {
  if (typeof reply === "string") return bytesToBlob(reply, FALLBACK_MIME_TYPE);
  if (isRecord(reply)) {
    const bytes = firstString(reply, ["base64", "data", "body"]);
    if (bytes !== null) {
      const type = firstString(reply, ["mimeType", "contentType", "type"]) || FALLBACK_MIME_TYPE;
      return bytesToBlob(bytes, type);
    }
  }
  return new Blob([JSON.stringify(reply ?? null)], { type: "application/json" });
}

export async function fetchSiteBlob(path: string): Promise<Blob> {
  return binaryReplyToBlob(await siteGet<unknown>(path));
}

/** A card picture as a Blob: proxy sources through Rust, anything else as an ordinary URL. */
export async function fetchBotBrowserAssetBlob(src: string): Promise<Blob> {
  if (src.startsWith(PROXY_IMAGE_PREFIX)) return fetchSiteBlob(src.slice(PROXY_IMAGE_PREFIX.length));
  return loadUrlBlob(src);
}

// ── JannyAI browser fallback ──

const JANNY_SITE_SEARCH_URL = "https://search.jannyai.com/multi-search";
const JANNY_CLIENT_HEADER = "Meilisearch instant-meilisearch (v0.19.0) ; Meilisearch JavaScript (v0.41.0)";

function isBlockedByJanny(error: unknown): boolean {
  const details = isRecord(error) ? error.details : undefined;
  if (isRecord(details) && details.code === "upstream_blocked") return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /cloudflare/i.test(text);
}

/**
 * JannyAI search through Rust. When the site blocks the app, the web view gets a fresh token and sends the same
 * multi-search body to the site itself. Any other failure is raised as is.
 */
export async function searchJannyWithFallback<T>(body: unknown): Promise<T> {
  try {
    return await sitePost<T>("janny/search", { payload: body });
  } catch (error) {
    if (!isBlockedByJanny(error)) throw error;
  }

  const tokenReply = await siteGet<unknown>("janny/token?force=true");
  const token = isRecord(tokenReply) && typeof tokenReply.token === "string" ? tokenReply.token.trim() : "";
  if (!token) throw new Error("JannyAI search token is unavailable");

  const response = await fetch(JANNY_SITE_SEARCH_URL, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-meilisearch-client": JANNY_CLIENT_HEADER,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`JannyAI browser fallback returned ${response.status}`);
  return (await response.json()) as T;
}
