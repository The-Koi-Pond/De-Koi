import { downloadPayloadFromApiValue, triggerDownload, type DownloadPayload } from "./download-payload";
import { invokeTauri } from "./tauri-client";

type ExportFormat = string | null | undefined;

async function exportDownload(command: string, args: Record<string, unknown>, fallbackFilename: string) {
  const value = await invokeTauri(command, args);
  return downloadPayloadFromApiValue(value, fallbackFilename);
}

async function download(command: string, args: Record<string, unknown>, fallbackFilename: string) {
  triggerDownload(await exportDownload(command, args, fallbackFilename));
}

export const exportApi = {
  prompt: (presetId: string): Promise<DownloadPayload> =>
    exportDownload("prompt_export", { presetId }, "preset.dekoi.json"),
  promptsBulk: (ids: string[]): Promise<DownloadPayload> =>
    exportDownload("prompts_export_bulk", { ids }, "de-koi-presets.zip"),
  character: (id: string, format?: ExportFormat): Promise<DownloadPayload> =>
    exportDownload(
      "character_export",
      { id, format: format ?? null },
      format === "compatible" ? "character.json" : "character.dekoi.json",
    ),
  characterPng: (id: string): Promise<DownloadPayload> =>
    exportDownload("character_export_png", { id }, "character.png"),
  charactersBulk: (ids: string[], format?: ExportFormat): Promise<DownloadPayload> =>
    exportDownload("characters_export_bulk", { ids, format: format ?? null }, "de-koi-characters.zip"),
  persona: (id: string, format?: ExportFormat): Promise<DownloadPayload> =>
    exportDownload(
      "persona_export",
      { id, format: format ?? null },
      format === "compatible" ? "persona.json" : "persona.dekoi.json",
    ),
  personasBulk: (ids: string[], format?: ExportFormat): Promise<DownloadPayload> =>
    exportDownload("personas_export_bulk", { ids, format: format ?? null }, "de-koi-personas.zip"),
  lorebook: (id: string, format?: ExportFormat): Promise<DownloadPayload> =>
    exportDownload(
      "lorebook_export",
      { id, format: format ?? null },
      format === "compatible" ? "lorebook.json" : "lorebook.dekoi.json",
    ),
  lorebooksBulk: (ids: string[], format?: ExportFormat): Promise<DownloadPayload> =>
    exportDownload("lorebooks_export_bulk", { ids, format: format ?? null }, "de-koi-lorebooks.zip"),
  download,
  triggerDownload,
};
