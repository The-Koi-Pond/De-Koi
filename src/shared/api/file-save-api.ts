import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { triggerDownload, type DownloadPayload } from "./download-payload";
import { hasEmbeddedTauriIpc, invokeTauri } from "./tauri-client";

type BrowserSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

type BrowserWindowWithSavePicker = Window & {
  showSaveFilePicker?: BrowserSaveFilePicker;
};

const NATIVE_SAVE_CHUNK_BYTES = 1024 * 1024;

export type SaveFileResult = "saved" | "downloaded" | "cancelled";
export type SaveTextFileResult = SaveFileResult;

type SaveFileFilter = { name: string; extensions: string[] };

export type SaveFileOptions = {
  filename: string;
  blob: Blob;
  title?: string;
  filters?: SaveFileFilter[];
};

export type SaveTextFileOptions = {
  filename: string;
  content: string;
  title?: string;
  mimeType?: string;
  filters?: SaveFileFilter[];
};

export type SaveDownloadPayloadOptions = {
  title?: string;
  filters?: SaveFileFilter[];
};

function browserExtensions(extensions: string[]): string[] {
  return extensions.map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
}

function browserAcceptMimeType(type: string): string {
  return type.split(";")[0]?.trim() || "application/octet-stream";
}

function browserFilePickerTypes(filters: SaveFileFilter[], mimeType: string) {
  return filters.map((filter) => ({
    description: filter.name,
    accept: { [browserAcceptMimeType(mimeType)]: browserExtensions(filter.extensions) },
  }));
}

function extensionFromFilename(filename: string): string {
  const match = /\.([^.\\/]+)$/.exec(filename.trim());
  return match?.[1] || "bin";
}

function defaultFilters(filename: string): SaveFileFilter[] {
  return [{ name: "File", extensions: [extensionFromFilename(filename)] }];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function saveBlobToNativePath(path: string, blob: Blob): Promise<void> {
  if (blob.size === 0) {
    await invokeTauri("local_file_save", { path, base64: "", append: false });
    return;
  }

  for (let offset = 0; offset < blob.size; offset += NATIVE_SAVE_CHUNK_BYTES) {
    const chunk = blob.slice(offset, offset + NATIVE_SAVE_CHUNK_BYTES);
    const bytes = new Uint8Array(await chunk.arrayBuffer());
    await invokeTauri("local_file_save", { path, base64: bytesToBase64(bytes), append: offset > 0 });
  }
}

function canUseEmbeddedNativeFileSave(): boolean {
  return hasEmbeddedTauriIpc();
}

export function canUseEmbeddedNativeTextFileSave(): boolean {
  return canUseEmbeddedNativeFileSave();
}

async function saveFileWithEmbeddedNativeDialog({
  filename,
  blob,
  title = "Save file",
  filters = defaultFilters(filename),
}: SaveFileOptions): Promise<SaveFileResult> {
  if (!canUseEmbeddedNativeFileSave()) {
    throw new Error("Native file save is only available in the embedded Tauri shell.");
  }

  const path = await saveDialog({
    title,
    defaultPath: filename,
    filters,
  });
  if (!path) return "cancelled";
  await saveBlobToNativePath(path, blob);
  return "saved";
}

async function saveFileWithBrowserPickerOrDownload({
  filename,
  blob,
  filters = defaultFilters(filename),
}: SaveFileOptions): Promise<SaveFileResult> {
  const saveFilePicker = (window as BrowserWindowWithSavePicker).showSaveFilePicker;
  if (saveFilePicker) {
    let fileHandle: Awaited<ReturnType<BrowserSaveFilePicker>>;
    try {
      fileHandle = await saveFilePicker({
        suggestedName: filename,
        types: browserFilePickerTypes(filters, blob.type),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }

    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  }

  triggerDownload({ blob, filename });
  return "downloaded";
}

export async function saveFileToUserSelectedLocation(options: SaveFileOptions): Promise<SaveFileResult> {
  if (canUseEmbeddedNativeFileSave()) {
    return saveFileWithEmbeddedNativeDialog(options);
  }

  return saveFileWithBrowserPickerOrDownload(options);
}

export async function saveTextFileToUserSelectedLocation({
  filename,
  content,
  mimeType = "text/plain;charset=utf-8",
  ...rest
}: SaveTextFileOptions): Promise<SaveTextFileResult> {
  return saveFileToUserSelectedLocation({
    ...rest,
    filename,
    blob: new Blob([content], { type: mimeType }),
  });
}

export async function saveDownloadPayloadToUserSelectedLocation(
  payload: DownloadPayload,
  options: SaveDownloadPayloadOptions = {},
): Promise<SaveFileResult> {
  return saveFileToUserSelectedLocation({
    filename: payload.filename,
    blob: payload.blob,
    title: options.title,
    filters: options.filters,
  });
}
