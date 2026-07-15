import type { ExtensionPackagePermission, InstalledExtension } from "../../../../engine/contracts/types/extension";

export type ExtensionCapabilityStatus = "available" | "unavailable" | "legacy-unscoped";
export interface ExtensionCapabilityView {
  permission: ExtensionPackagePermission | "legacy";
  status: ExtensionCapabilityStatus;
  label: string;
}

const labels: Record<ExtensionPackagePermission, string> = {
  "ui:styles": "Add styles through De-Koi",
  "runtime:dom": "Use De-Koi DOM and cleanup helpers",
  "storage:plugin-memory": "Use namespaced extension storage",
  "ui:settings": "Add Settings UI",
  "ui:overlay": "Add overlay UI",
  "ui:messages": "Add message UI",
  "prompt:read": "Read assembled prompts",
  "generation:request": "Request generation",
};

const available = new Set<ExtensionPackagePermission>(["ui:styles", "runtime:dom", "storage:plugin-memory"]);

export function extensionCapabilityView(extension: InstalledExtension): ExtensionCapabilityView[] {
  if (extension.source !== "package" && extension.manifestVersion == null) {
    return [{ permission: "legacy", status: "legacy-unscoped", label: "Legacy De-Koi helper surface" }];
  }
  return (extension.permissions ?? []).map((permission) => ({
    permission,
    status: available.has(permission) ? "available" : "unavailable",
    label: labels[permission],
  }));
}
