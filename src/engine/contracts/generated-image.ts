export interface GeneratedImageResult {
  image: string;
  base64: string;
  mimeType: string;
  ext: string;
  provider: string;
  model: string;
}

export type GeneratedImageResultInput = Partial<Record<keyof GeneratedImageResult, unknown>>;

export interface NormalizedGeneratedImage {
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  ext: "png" | "jpg" | "webp" | "gif";
}

const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
} as const;

type GeneratedImageExtension = keyof typeof MIME_BY_EXTENSION;
type GeneratedImageMimeType = (typeof MIME_BY_EXTENSION)[GeneratedImageExtension];

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function supportedExtension(value: unknown): GeneratedImageExtension | null {
  const normalized = readString(value).toLowerCase().replace(/^\./, "");
  if (normalized === "jpeg") return "jpg";
  return normalized in MIME_BY_EXTENSION ? (normalized as GeneratedImageExtension) : null;
}

function supportedMimeType(value: unknown): GeneratedImageMimeType | null {
  const normalized = readString(value).toLowerCase().split(";")[0]?.trim();
  if (normalized === "image/jpg") return "image/jpeg";
  return Object.values(MIME_BY_EXTENSION).includes(normalized as GeneratedImageMimeType)
    ? (normalized as GeneratedImageMimeType)
    : null;
}

function extensionForMimeType(mimeType: GeneratedImageMimeType): GeneratedImageExtension {
  return mimeType === "image/jpeg" ? "jpg" : (mimeType.slice("image/".length) as GeneratedImageExtension);
}

export function normalizeGeneratedImageResult(result: GeneratedImageResultInput): NormalizedGeneratedImage {
  const suppliedExtension = supportedExtension(result.ext);
  const mimeType = supportedMimeType(result.mimeType) ?? MIME_BY_EXTENSION[suppliedExtension ?? "png"];
  const ext = suppliedExtension ?? extensionForMimeType(mimeType);
  const directImage = readString(result.image);
  const base64 = readString(result.base64);

  return {
    dataUrl: directImage || (base64 ? `data:${mimeType};base64,${base64}` : ""),
    mimeType,
    ext,
  };
}
