// ──────────────────────────────────────────────
// CustomThemeInjector: Injects active custom theme
// CSS and enabled extension CSS/JS into the DOM
// ──────────────────────────────────────────────
import { useEffect } from "react";
import { useThemes } from "../../features/shell/settings/index";
import { useExtensions } from "../../features/shell/settings/index";
import { stripDangerousCss } from "../../shared/lib/chat-css";
import { extensionHasRunnableJavaScript } from "../../shared/lib/extension-import";
import { executeCustomExtensionJavaScript } from "./extension-runtime";
import { MAX_THEME_CSS_BYTES } from "../../engine/contracts/schemas/theme.schema";
import { MAX_EXTENSION_CSS_BYTES } from "../../engine/contracts/schemas/extension.schema";
import { utf8ByteLength } from "../../engine/contracts/text-bytes";

export function CustomThemeInjector() {
  const { data: installedExtensions = [] } = useExtensions();
  const { data: customThemes = [] } = useThemes();
  const activeTheme = customThemes.find((theme) => theme.isActive) ?? null;

  // Inject active custom theme CSS
  useEffect(() => {
    const id = "marinara-custom-theme";
    let style = document.getElementById(id) as HTMLStyleElement | null;

    if (!activeTheme || utf8ByteLength(activeTheme.css) > MAX_THEME_CSS_BYTES) {
      style?.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    // Theme CSS is injected raw into document.head, so it bypasses the card-CSS
    // sanitizer. Strip the network-exfil and script-injection vectors while leaving
    // a theme's legitimate token/!important/position overrides intact.
    style.textContent = stripDangerousCss(activeTheme.css);

    return () => {
      style?.remove();
    };
  }, [activeTheme]);

  // Inject enabled extension CSS
  useEffect(() => {
    const prefix = "marinara-ext-";

    // Remove old extension styles
    document.querySelectorAll(`style[id^="${prefix}"]`).forEach((el) => el.remove());

    // Inject enabled ones
    for (const ext of installedExtensions) {
      if (!ext) continue;
      if (!ext.enabled || !ext.css || utf8ByteLength(ext.css) > MAX_EXTENSION_CSS_BYTES) continue;
      const style = document.createElement("style");
      style.id = `${prefix}${ext.id}`;
      style.textContent = stripDangerousCss(ext.css);
      document.head.appendChild(style);
    }

    return () => {
      document.querySelectorAll(`style[id^="${prefix}"]`).forEach((el) => el.remove());
    };
  }, [installedExtensions]);

  // Execute enabled extension JS
  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
    const prefix = "marinara-ext-js-";

    // Remove old extension scripts
    document.querySelectorAll(`[id^="${prefix}"]`).forEach((el) => el.remove());

    for (const ext of installedExtensions) {
      if (!ext) continue;
      if (!ext.enabled || !extensionHasRunnableJavaScript(ext)) continue;

      try {
        const runningExtension = executeCustomExtensionJavaScript(ext);
        cleanupFns.push(runningExtension.cleanup);
      } catch (e) {
        console.error(`[Extension:${ext.name}] Failed to execute:`, e);
      }
    }

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, [installedExtensions]);

  return null;
}
