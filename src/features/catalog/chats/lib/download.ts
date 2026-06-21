import {
  saveFileToUserSelectedLocation,
  saveTextFileToUserSelectedLocation,
  type SaveFileResult,
} from "../../../../shared/api/file-save-api";

export function downloadTextFile(contents: string, filename: string, type: string): Promise<SaveFileResult> {
  return saveTextFileToUserSelectedLocation({
    content: contents,
    filename,
    mimeType: type,
    filters: [{ name: "Text", extensions: [filename.split(".").pop() || "txt"] }],
  });
}

export function downloadBlobFile(blob: Blob, filename: string): Promise<SaveFileResult> {
  return saveFileToUserSelectedLocation({ blob, filename });
}
