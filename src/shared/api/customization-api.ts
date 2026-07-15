import type { ExtensionDataRetention, InstalledExtension } from "../../engine/contracts/types/extension";
import type { Theme } from "../../engine/contracts/types/theme";
import { invokeTauri } from "./tauri-client";
import { remoteRuntimeTarget } from "./remote-runtime";

export function currentRuntimeConsentScope() {
  const target = remoteRuntimeTarget();
  return target ? `remote:${target.baseUrl}` : "embedded";
}

export const themesApi = {
  setActive: (themeId: string | null) => invokeTauri<Theme | null>("theme_set_active", { themeId }),
};

export type ExtensionDataPolicy = "retain" | "purge";
export interface ExtensionRemovalResult {
  extensionId: string;
  dataPolicy: ExtensionDataPolicy;
  retentionId: string | null;
  removedMemoryRows: number;
  retainedMemoryRows: number;
}

export const extensionsApi = {
  remove: (extensionId: string, dataPolicy: ExtensionDataPolicy) =>
    invokeTauri<ExtensionRemovalResult>("extension_remove", { extensionId, dataPolicy }),
  retainedData: () => invokeTauri<ExtensionDataRetention[]>("extension_retained_data_list"),
  reconnect: (extensionId: string, retentionId: string) =>
    invokeTauri<InstalledExtension>("extension_reconnect_data", { extensionId, retentionId }),
  purgeRetained: (retentionId: string) =>
    invokeTauri<{ retentionId: string; removedMemoryRows: number }>("extension_retained_data_purge", {
      retentionId,
    }),
};
