import { MAX_FILE_SIZES } from "../../engine/contracts/constants/defaults";

export interface UploadFilePayload {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  base64: string;
}

function formatUploadSize(bytes: number) {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib.toString() : mib.toFixed(1)} MB`;
}

export const MAX_IMAGE_UPLOAD_BYTES = MAX_FILE_SIZES.IMAGE_UPLOAD;
export const IMAGE_UPLOAD_SIZE_ERROR = `Image uploads must be ${formatUploadSize(MAX_IMAGE_UPLOAD_BYTES)} or smaller`;

export const MAX_CHARACTER_IMPORT_UPLOAD_BYTES = MAX_FILE_SIZES.CHARACTER_IMPORT;
export const CHARACTER_IMPORT_SIZE_ERROR = `Character imports must be ${formatUploadSize(MAX_CHARACTER_IMPORT_UPLOAD_BYTES)} or smaller`;
export const CHAT_IMPORT_SIZE_ERROR = `Chat imports must be ${formatUploadSize(MAX_FILE_SIZES.CHAT_JSONL)} or smaller`;
export const GAME_ASSET_SIZE_ERROR = `Game assets must be ${formatUploadSize(MAX_FILE_SIZES.GAME_ASSET)} or smaller`;
export const FONT_UPLOAD_SIZE_ERROR = `Font uploads must be ${formatUploadSize(MAX_FILE_SIZES.FONT_UPLOAD)} or smaller`;
export const MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES = MAX_FILE_SIZES.KNOWLEDGE_SOURCE;
export const KNOWLEDGE_SOURCE_UPLOAD_SIZE_ERROR = `Knowledge source uploads must be ${formatUploadSize(MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES)} or smaller`;

export interface FilePayloadOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

const BASE64_BYTE_CHUNK_SIZE = 32_766;

function bytesToBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_BYTE_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_BYTE_CHUNK_SIZE);
    encoded += btoa(String.fromCharCode(...chunk));
  }
  return encoded;
}

export async function fileToUploadPayload(file: File, options: FilePayloadOptions = {}): Promise<UploadFilePayload> {
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    throw new Error(options.tooLargeMessage ?? `Uploads must be ${options.maxBytes} bytes or smaller`);
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    base64: bytesToBase64(bytes),
  };
}

export function dataUrlToUploadPayload(
  dataUrl: string,
  filename: string,
  options: FilePayloadOptions = {},
): UploadFilePayload {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/i.exec(dataUrl.trim());
  if (!match) throw new Error("Generated image must be an inline base64 image data URL");
  const type = match[1]?.trim() || "image/png";
  if (!type.toLowerCase().startsWith("image/")) throw new Error("Generated banner must be an image");
  const base64 = (match[2] ?? "").replace(/\s+/g, "");
  const binary = atob(base64);
  if (options.maxBytes !== undefined && binary.length > options.maxBytes) {
    throw new Error(options.tooLargeMessage ?? `Uploads must be ${options.maxBytes} bytes or smaller`);
  }
  return {
    name: filename,
    type,
    size: binary.length,
    lastModified: Date.now(),
    base64,
  };
}
export async function formDataToJson(
  body: FormData,
  options: FilePayloadOptions = {},
): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};
  const appendEntry = (key: string, value: unknown) => {
    const existing = entries[key];
    if (existing === undefined) {
      entries[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      entries[key] = [existing, value];
    }
  };
  for (const [key, value] of body.entries()) {
    // Pass the caller's size limit down so a File entry is rejected before its
    // bytes are read into memory, rather than after.
    appendEntry(key, value instanceof File ? await fileToUploadPayload(value, options) : value);
  }
  return entries;
}
