import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { triggerDownload } from "./download-payload";
import { invokeTauri } from "./tauri-client";

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

export type SaveTextFileResult = "saved" | "downloaded" | "cancelled";

export type SaveTextFileOptions = {
  filename: string;
  content: string;
  title?: string;
  mimeType?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

function browserExtensions(extensions: string[]): string[] {
  return extensions.map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
}

function browserFilePickerTypes(filters: Array<{ name: string; extensions: string[] }>, mimeType: string) {
  return filters.map((filter) => ({
    description: filter.name,
    accept: { [mimeType]: browserExtensions(filter.extensions) },
  }));
}

export function canUseEmbeddedNativeTextFileSave(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

async function saveTextFileWithEmbeddedNativeDialog({
  filename,
  content,
  title = "Save file",
  filters = [{ name: "Text", extensions: ["txt"] }],
}: SaveTextFileOptions): Promise<SaveTextFileResult> {
  if (!canUseEmbeddedNativeTextFileSave()) {
    throw new Error("Native file save is only available in the embedded Tauri shell.");
  }

  const path = await saveDialog({
    title,
    defaultPath: filename,
    filters,
  });
  if (!path) return "cancelled";
  await invokeTauri("local_text_file_save", { path, content });
  return "saved";
}

async function saveTextFileWithBrowserPickerOrDownload({
  filename,
  content,
  mimeType = "text/plain;charset=utf-8",
  filters = [{ name: "Text", extensions: ["txt"] }],
}: SaveTextFileOptions): Promise<SaveTextFileResult> {
  const blob = new Blob([content], { type: mimeType });
  const saveFilePicker = (window as BrowserWindowWithSavePicker).showSaveFilePicker;
  if (saveFilePicker) {
    let fileHandle: Awaited<ReturnType<BrowserSaveFilePicker>>;
    try {
      fileHandle = await saveFilePicker({
        suggestedName: filename,
        types: browserFilePickerTypes(filters, mimeType),
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

export async function saveTextFileToUserSelectedLocation(options: SaveTextFileOptions): Promise<SaveTextFileResult> {
  // The native branch requires embedded Tauri IPC, not just a runtime label.
  // Hostable and browser shells stay on browser-owned picker/download behavior.
  if (canUseEmbeddedNativeTextFileSave()) {
    return saveTextFileWithEmbeddedNativeDialog(options);
  }

  return saveTextFileWithBrowserPickerOrDownload(options);
}
