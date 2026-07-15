export type FontFolderCapability = "supported" | "unsupported" | "error";

export function fontManagementMode(capability: FontFolderCapability): "folder" | "upload" | "unavailable" {
  if (capability === "supported") return "folder";
  return capability === "unsupported" ? "upload" : "unavailable";
}
