// ──────────────────────────────────────────────
// CustomThemeInjector: Injects active custom theme
// CSS and enabled extension CSS/JS into the DOM
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useThemes } from "../../features/shell/settings/index";
import { useExtensions } from "../../features/shell/settings/index";
import { stripDangerousCss } from "../../shared/lib/chat-css";
import { extensionHasRunnableJavaScript } from "../../shared/lib/extension-import";
import { executeCustomExtensionJavaScript } from "./extension-runtime";
import { MAX_THEME_CSS_BYTES } from "../../engine/contracts/schemas/theme.schema";
import { MAX_EXTENSION_CSS_BYTES } from "../../engine/contracts/schemas/extension.schema";
import { utf8ByteLength } from "../../engine/contracts/text-bytes";
import {
  EXTENSION_CONSENT_CHANGED_EVENT,
  extensionConsentEventAffects,
  extensionConsentFingerprint,
  extensionDeviceConsentStore,
} from "../../shared/lib/extension-device-consent";
import { currentRuntimeConsentScope } from "../../shared/api/customization-api";
import { extensionCompatibilityAllowsActivation } from "../../engine/contracts/extension-compatibility";
import type { InstalledExtension } from "../../engine/contracts/types/extension";
import type { Theme } from "../../engine/contracts/types/theme";

const EMPTY_EXTENSIONS: InstalledExtension[] = [];
const EMPTY_THEMES: Theme[] = [];

function extensionCanRun(extension: InstalledExtension) {
  try {
    return extensionCompatibilityAllowsActivation(extension);
  } catch {
    return false;
  }
}

export function CustomThemeInjector() {
  const { data: installedExtensionRows } = useExtensions();
  const { data: customThemeRows } = useThemes();
  const installedExtensions = installedExtensionRows ?? EMPTY_EXTENSIONS;
  const customThemes = customThemeRows ?? EMPTY_THEMES;
  const activeTheme = customThemes.find((theme) => theme && typeof theme === "object" && theme.isActive) ?? null;
  const [consentRevision, setConsentRevision] = useState(0);
  const [deviceActivation, setDeviceActivation] = useState<Record<string, { css: boolean; javascript: boolean }>>({});

  useEffect(() => {
    const refresh = (event: Event) => {
      const runtimeScope = currentRuntimeConsentScope();
      const extensionIds = installedExtensions.map((extension) => extension.id);
      if (extensionConsentEventAffects(event, runtimeScope, extensionIds)) {
        setConsentRevision((revision) => revision + 1);
      }
    };
    globalThis.addEventListener(EXTENSION_CONSENT_CHANGED_EVENT, refresh);
    return () => globalThis.removeEventListener(EXTENSION_CONSENT_CHANGED_EVENT, refresh);
  }, [installedExtensions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, { css: boolean; javascript: boolean }> = {};
      try {
        const runtimeScope = currentRuntimeConsentScope();
        for (const extension of installedExtensions) {
          if (!extension?.enabled) continue;
          if (!extensionCanRun(extension)) continue;
          const fingerprint = await extensionConsentFingerprint(extension);
          const consent = extensionDeviceConsentStore.read(runtimeScope, extension.id, fingerprint);
          if (consent) next[extension.id] = { css: consent.css, javascript: consent.javascript };
        }
      } catch (error) {
        console.error("[Extensions] Device activation could not be verified:", error);
      }
      if (!cancelled) setDeviceActivation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [installedExtensions, consentRevision]);

  // Inject active custom theme CSS
  useEffect(() => {
    const id = "marinara-custom-theme";
    let style = document.getElementById(id) as HTMLStyleElement | null;

    if (
      !activeTheme ||
      typeof activeTheme.css !== "string" ||
      utf8ByteLength(activeTheme.css) > MAX_THEME_CSS_BYTES
    ) {
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
      if (
        !ext.enabled ||
        !extensionCanRun(ext) ||
        !deviceActivation[ext.id]?.css ||
        typeof ext.css !== "string" ||
        !ext.css ||
        utf8ByteLength(ext.css) > MAX_EXTENSION_CSS_BYTES
      ) continue;
      const style = document.createElement("style");
      style.id = `${prefix}${ext.id}`;
      style.textContent = stripDangerousCss(ext.css);
      document.head.appendChild(style);
    }

    return () => {
      document.querySelectorAll(`style[id^="${prefix}"]`).forEach((el) => el.remove());
    };
  }, [installedExtensions, deviceActivation]);

  // Execute enabled extension JS
  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
    const prefix = "marinara-ext-js-";

    // Remove old extension scripts
    document.querySelectorAll(`[id^="${prefix}"]`).forEach((el) => el.remove());

    for (const ext of installedExtensions) {
      if (!ext) continue;
      if (
        !ext.enabled ||
        !extensionCanRun(ext) ||
        !deviceActivation[ext.id]?.javascript ||
        !extensionHasRunnableJavaScript(ext)
      ) continue;

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
  }, [installedExtensions, deviceActivation]);

  return null;
}
