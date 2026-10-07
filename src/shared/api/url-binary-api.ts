import { remoteHeaders, remoteRuntimeTarget, type RuntimeTarget } from "./remote-runtime";
import { invokeTauri } from "./tauri-client";

interface UrlBinaryResponse {
  base64?: string;
  mimeType?: string;
  message?: string;
  error?: string;
}

function isUrlBinaryResponse(value: unknown): value is UrlBinaryResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function binaryFailureMessage(response: unknown): string {
  if (!isUrlBinaryResponse(response)) {
    return `URL binary request returned an invalid response: ${String(response)}`;
  }
  return (
    optionalString(response.error) ??
    optionalString(response.message) ??
    "URL binary request did not return base64 data."
  );
}

function base64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("URL binary request returned invalid base64 data.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  return new Blob([bytesToArrayBuffer(base64ToBytes(base64))], { type: mimeType });
}

/**
 * The remote runtime's own managed-asset URLs (`<runtime>/api/assets/...`). The browser loads these
 * directly: routing them through `load_url_binary` makes the server fetch its own address, which its
 * outbound-URL guard rejects as a local or private host.
 */
function remoteRuntimeAssetRequest(url: string): { url: string; target: RuntimeTarget } | null {
  const target = remoteRuntimeTarget();
  if (!target) return null;
  const base = new URL(`${target.baseUrl}/`);
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin || !parsed.pathname.startsWith(`${base.pathname}api/assets/`)) return null;
  return { url: parsed.toString(), target };
}

async function loadRemoteRuntimeAsset(
  request: { url: string; target: RuntimeTarget },
  fallbackMimeType: string,
): Promise<Blob> {
  const response = await fetch(request.url, { method: "GET", headers: remoteHeaders(request.target) });
  if (!response.ok) {
    throw new Error(`Remote runtime asset returned ${response.status}`);
  }
  const blob = await response.blob();
  return blob.type ? blob : new Blob([blob], { type: fallbackMimeType });
}

export const urlBinaryApi = {
  load: async (url: string, fallbackMimeType = "application/octet-stream"): Promise<Blob> => {
    const runtimeAsset = remoteRuntimeAssetRequest(url);
    if (runtimeAsset) return loadRemoteRuntimeAsset(runtimeAsset, fallbackMimeType);
    const response = await invokeTauri<unknown>("load_url_binary", {
      url,
      fallbackMime: fallbackMimeType,
    });
    if (!isUrlBinaryResponse(response) || typeof response.base64 !== "string") {
      throw new Error(binaryFailureMessage(response));
    }
    return base64ToBlob(response.base64, optionalString(response.mimeType) ?? fallbackMimeType);
  },
};
