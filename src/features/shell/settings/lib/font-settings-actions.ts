export function fontManagementMode(canOpenFolder: boolean): "folder" | "upload" {
  return canOpenFolder ? "folder" : "upload";
}
