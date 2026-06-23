export type ExtensionPackagePermission =
  | "ui:styles"
  | "ui:settings"
  | "ui:overlay"
  | "ui:messages"
  | "storage:plugin-memory"
  | "runtime:dom"
  | "prompt:read"
  | "generation:request";

export type ExtensionPackageUiSlot = "settings" | "overlay" | "messages" | "theme";

export interface ExtensionPackageCompatibility {
  deKoi?: string;
}

export interface ExtensionUiContributions {
  slots?: ExtensionPackageUiSlot[];
}

export type ExtensionSource = "file" | "package" | "profile";

/**
 * A user-installed extension stored on the Marinara server.
 *
 * Extension JS is delivered to the client as part of the list payload and
 * executed in the page via the existing blob-URL loader in
 * `CustomThemeInjector.tsx`. There is no server-side script-serving endpoint -
 * CSP/eval characteristics are governed entirely by that loader.
 */
export interface InstalledExtension {
  id: string;
  name: string;
  description: string;
  /** Optional CSS injected as a <style> tag while enabled. */
  css?: string | null;
  /** Optional JavaScript payload consumed by the client loader while enabled. */
  js?: string | null;
  /** Whether the extension is currently active. */
  enabled: boolean;
  /** When the user originally imported it. */
  installedAt: string;
  /** Manifest package id for package-based extension imports. */
  packageId?: string | null;
  /** Manifest package version for package-based extension imports. */
  packageVersion?: string | null;
  /** Manifest schema version accepted by De-Koi. */
  manifestVersion?: number | null;
  /** Declared app compatibility metadata. Metadata only in v1. */
  compatibility?: ExtensionPackageCompatibility | null;
  /** Declared extension permissions. Metadata only in v1. */
  permissions?: ExtensionPackagePermission[] | null;
  /** Declared safe UI contribution points. Metadata only in v1. */
  uiContributions?: ExtensionUiContributions | null;
  /** Where this extension row came from. */
  source?: ExtensionSource | null;
  createdAt: string;
  updatedAt: string;
}