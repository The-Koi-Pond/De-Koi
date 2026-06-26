import { readString } from "../../generation/runtime-records";

export type IllustrationReferenceData = {
  referenceImages: string[];
  referenceSubjectNames: string[];
  selectedReferences: Array<{ image: string; subjectName: string }>;
};

const MAX_ILLUSTRATION_REFERENCE_IMAGES = 8;
const ILLUSTRATION_REFERENCE_IMAGE_BYTE_LIMIT = 6 * 1024 * 1024;
const ILLUSTRATION_REFERENCE_IMAGES_TOTAL_WIRE_BYTE_LIMIT = 16 * 1024 * 1024;
const ILLUSTRATION_REFERENCE_REQUEST_WIRE_RESERVE_BYTES = 64 * 1024;

type ParsedImagePayload = {
  mimeType: string;
  payload: string;
  normalizedImage: string;
};

function base64Payload(value: string): string {
  const payload = value.replace(/\s+/g, "");
  return /^[A-Za-z0-9+/=]+$/.test(payload) ? payload : "";
}

function imageMimeTypeFromSignature(binary: string): string {
  const byte = (index: number) => binary.charCodeAt(index);
  if (byte(0) === 0x89 && binary.slice(1, 4) === "PNG" && byte(4) === 0x0d && byte(5) === 0x0a) {
    return "image/png";
  }
  if (byte(0) === 0xff && byte(1) === 0xd8) return "image/jpeg";
  if (binary.startsWith("GIF87a") || binary.startsWith("GIF89a")) return "image/gif";
  if (binary.startsWith("RIFF") && binary.slice(8, 12) === "WEBP") return "image/webp";
  return "";
}

function parseBase64ImagePayload(value: string): { declaredMimeType: string; payload: string } | null {
  const commaIndex = value.indexOf(",");
  if (value.startsWith("data:") && commaIndex >= 0) {
    const metadata = value.slice(0, commaIndex).toLowerCase();
    if (!metadata.startsWith("data:image/") || !metadata.includes(";base64")) return null;
    const declaredMimeType = metadata.slice("data:".length).split(";")[0]?.trim() ?? "";
    const payload = base64Payload(value.slice(commaIndex + 1));
    return declaredMimeType && payload ? { declaredMimeType, payload } : null;
  }
  const payload = base64Payload(value);
  return payload ? { declaredMimeType: "", payload } : null;
}

function decodedImagePayload(value: string): ParsedImagePayload | null {
  const parsed = parseBase64ImagePayload(value);
  if (!parsed || parsed.payload.length <= 80) return null;
  if (parsed.payload.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.payload) || /=/.test(parsed.payload.slice(0, -2))) return null;
  try {
    const binary = atob(parsed.payload);
    const signatureMimeType = imageMimeTypeFromSignature(binary);
    if (!signatureMimeType) return null;
    if (parsed.declaredMimeType && parsed.declaredMimeType !== signatureMimeType) return null;
    return {
      mimeType: signatureMimeType,
      payload: parsed.payload,
      normalizedImage: parsed.declaredMimeType ? value : `data:${signatureMimeType};base64,${parsed.payload}`,
    };
  } catch {
    return null;
  }
}

export type IllustrationImageRequestWireShape = {
  connectionId?: string;
  kind?: string;
  reviewId?: string;
  reviewTitle?: string;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  referenceImages?: readonly string[];
};

export function illustrationImageRequestWireBytes(request: IllustrationImageRequestWireShape): number {
  return new TextEncoder().encode(
    JSON.stringify({
      connectionId: request.connectionId ?? "",
      kind: request.kind ?? "illustration",
      reviewId: request.reviewId ?? "",
      reviewTitle: request.reviewTitle ?? "Scene illustration",
      prompt: request.prompt ?? "",
      negativePrompt: request.negativePrompt ?? "",
      width: request.width ?? 0,
      height: request.height ?? 0,
      referenceImages: request.referenceImages ?? [],
    }),
  ).length;
}

function referenceImagesRequestWireBytes(images: readonly string[]): number {
  return (
    illustrationImageRequestWireBytes({ referenceImages: images }) + ILLUSTRATION_REFERENCE_REQUEST_WIRE_RESERVE_BYTES
  );
}

export function usableIllustrationReferenceImage(value: unknown): string {
  const text = readString(value).trim();
  if (!text) return "";
  const decoded = decodedImagePayload(text);
  if (!decoded || decoded.payload.length <= 80) return "";
  return atob(decoded.payload).length <= ILLUSTRATION_REFERENCE_IMAGE_BYTE_LIMIT ? decoded.normalizedImage : "";
}

export function illustrationReferencesForRequest(
  references: readonly { image: unknown; subjectName?: unknown }[],
): IllustrationReferenceData {
  const referenceImages: string[] = [];
  const referenceSubjectNames: string[] = [];
  const selectedReferences: Array<{ image: string; subjectName: string }> = [];
  const seen = new Set<string>();

  const addSubjectName = (value: unknown) => {
    const name = readString(value).trim();
    if (name && !referenceSubjectNames.includes(name)) referenceSubjectNames.push(name);
  };

  for (const value of references) {
    const image = usableIllustrationReferenceImage(value.image);
    if (!image) continue;
    const key = image.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    if (referenceImages.length >= MAX_ILLUSTRATION_REFERENCE_IMAGES) continue;
    const projected = [...referenceImages, image];
    if (referenceImagesRequestWireBytes(projected) > ILLUSTRATION_REFERENCE_IMAGES_TOTAL_WIRE_BYTE_LIMIT) continue;
    referenceImages.push(image);
    seen.add(key);
    const subjectName = readString(value.subjectName).trim();
    if (subjectName) selectedReferences.push({ image, subjectName });
    addSubjectName(subjectName);
  }

  return { referenceImages, referenceSubjectNames, selectedReferences };
}

export function illustrationReferenceImagesForRequest(images: readonly unknown[]): string[] {
  return illustrationReferencesForRequest(images.map((image) => ({ image }))).referenceImages;
}
