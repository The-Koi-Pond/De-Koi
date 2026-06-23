import type { CreateExtensionInput } from "../../engine/contracts/schemas/extension.schema";
import type { ExtensionPackagePermission, ExtensionPackageUiSlot } from "../../engine/contracts/types/extension";

type ExtensionImportPayload = {
  js?: string | null;
};

export type ExtensionImportKind = "package-json" | "legacy-json" | "css-file" | "js-file";

export interface ImportedExtensionBuildResult {
  kind: ExtensionImportKind;
  input: CreateExtensionInput;
  hasRunnableJavaScript: boolean;
}

const SUPPORTED_PERMISSIONS = new Set<ExtensionPackagePermission>([
  "ui:styles",
  "ui:settings",
  "ui:overlay",
  "ui:messages",
  "storage:plugin-memory",
  "runtime:dom",
  "prompt:read",
  "generation:request",
]);

const SUPPORTED_UI_SLOTS = new Set<ExtensionPackageUiSlot>(["settings", "overlay", "messages", "theme"]);
const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/i;

export function extensionHasRunnableJavaScript<T extends ExtensionImportPayload>(
  extension: T,
): extension is T & { js: string } {
  return typeof extension.js === "string" && extension.js.trim().length > 0;
}

export function getInitialImportedExtensionEnabled(extension: ExtensionImportPayload) {
  return !extensionHasRunnableJavaScript(extension);
}

function stripExtension(filename: string, extension: string): string {
  return filename.replace(new RegExp(`${extension}$`, "i"), "");
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readOptionalRecord(value: unknown, field: string): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`Extension package ${field} must be an object or null.`);
}

function readStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Extension package ${field} must be an array.`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`Extension package ${field} entries must be strings.`);
    return item;
  });
}

function assertPackageId(value: string): string {
  const trimmed = value.trim();
  if (!PACKAGE_ID_PATTERN.test(trimmed)) {
    throw new Error("Extension package id must be a stable id using letters, numbers, dots, dashes, or underscores.");
  }
  return trimmed;
}

function normalizePermissions(value: unknown): ExtensionPackagePermission[] {
  return readStringArray(value, "permissions").map((permission) => {
    if (!SUPPORTED_PERMISSIONS.has(permission as ExtensionPackagePermission)) {
      throw new Error(`Unsupported extension permission: ${permission}`);
    }
    return permission as ExtensionPackagePermission;
  });
}

function normalizeSlots(value: unknown): ExtensionPackageUiSlot[] {
  return readStringArray(value, "ui.slots").map((slot) => {
    if (!SUPPORTED_UI_SLOTS.has(slot as ExtensionPackageUiSlot)) {
      throw new Error(`Unsupported extension UI slot: ${slot}`);
    }
    return slot as ExtensionPackageUiSlot;
  });
}

function parseJsonExtension(fileName: string, text: string, installedAt: string): ImportedExtensionBuildResult {
  const parsed = readRecord(JSON.parse(text));
  const entrypoints = readOptionalRecord(parsed.entrypoints, "entrypoints") ?? {};
  const isPackage = parsed.manifestVersion !== undefined || parsed.entrypoints !== undefined;

  if (!isPackage) {
    const js = readString(parsed.js);
    const input: CreateExtensionInput = {
      name: readString(parsed.name) ?? stripExtension(fileName, "\\.json"),
      description: readString(parsed.description) ?? "",
      css: readString(parsed.css),
      js,
      enabled: getInitialImportedExtensionEnabled({ js }),
      installedAt,
      source: "file",
    };
    return { kind: "legacy-json", input, hasRunnableJavaScript: extensionHasRunnableJavaScript({ js }) };
  }

  if (parsed.manifestVersion !== 1) throw new Error("Extension package manifestVersion must be 1.");
  const packageId = assertPackageId(readString(parsed.id) ?? "");
  const name = readString(parsed.name) ?? packageId;
  const packageVersion = readString(parsed.version);
  if (!packageVersion) throw new Error("Extension package version is required.");

  const js = readString(entrypoints.js);
  const css = readString(entrypoints.css);
  const compatibility = readOptionalRecord(parsed.compatibility, "compatibility");
  if (compatibility?.deKoi !== undefined && typeof compatibility.deKoi !== "string") {
    throw new Error("Extension package compatibility.deKoi must be a string.");
  }
  const ui = readOptionalRecord(parsed.ui, "ui");
  const declaredSlots = ui?.slots === undefined ? null : normalizeSlots(ui.slots);
  const input: CreateExtensionInput = {
    name,
    description: readString(parsed.description) ?? "",
    css,
    js,
    enabled: getInitialImportedExtensionEnabled({ js }),
    installedAt,
    packageId,
    packageVersion,
    manifestVersion: 1,
    compatibility: compatibility ? { deKoi: readString(compatibility.deKoi) ?? undefined } : null,
    permissions: normalizePermissions(parsed.permissions),
    ...(ui ? { uiContributions: declaredSlots ? { slots: declaredSlots } : {} } : {}),
    source: "package",
  };
  return { kind: "package-json", input, hasRunnableJavaScript: extensionHasRunnableJavaScript({ js }) };
}

export function buildImportedExtensionInput(
  fileName: string,
  text: string,
  installedAt: string,
): ImportedExtensionBuildResult {
  if (/\.json$/i.test(fileName)) return parseJsonExtension(fileName, text, installedAt);
  if (/\.js$/i.test(fileName)) {
    const input: CreateExtensionInput = {
      name: stripExtension(fileName, "\\.js"),
      description: "JS extension imported from file",
      js: text,
      enabled: getInitialImportedExtensionEnabled({ js: text }),
      installedAt,
      source: "file",
    };
    return { kind: "js-file", input, hasRunnableJavaScript: extensionHasRunnableJavaScript({ js: text }) };
  }
  if (/\.css$/i.test(fileName)) {
    const input: CreateExtensionInput = {
      name: stripExtension(fileName, "\\.css"),
      description: "CSS extension imported from file",
      css: text,
      enabled: true,
      installedAt,
      source: "file",
    };
    return { kind: "css-file", input, hasRunnableJavaScript: false };
  }
  throw new Error("Only .json, .css, and .js extension files are supported.");
}