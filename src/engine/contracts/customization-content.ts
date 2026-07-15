import { MAX_EXTENSION_CSS_BYTES } from "./schemas/extension.schema";
import { MAX_THEME_CSS_BYTES } from "./schemas/theme.schema";
import { utf8ByteLength } from "./text-bytes";

function isInjectableCss(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && utf8ByteLength(value) <= maxBytes;
}

export function isInjectableThemeCss(value: unknown): value is string {
  return isInjectableCss(value, MAX_THEME_CSS_BYTES);
}

export function isInjectableExtensionCss(value: unknown): value is string {
  return isInjectableCss(value, MAX_EXTENSION_CSS_BYTES);
}
