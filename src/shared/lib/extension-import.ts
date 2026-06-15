type ExtensionImportPayload = {
  js?: string | null;
};

export function extensionHasRunnableJavaScript<T extends ExtensionImportPayload>(
  extension: T,
): extension is T & { js: string } {
  return typeof extension.js === "string" && extension.js.trim().length > 0;
}

export function getInitialImportedExtensionEnabled(extension: ExtensionImportPayload) {
  return !extensionHasRunnableJavaScript(extension);
}
