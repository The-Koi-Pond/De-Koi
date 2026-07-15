import { useCallback, useEffect, useState } from "react";
import type { InstalledExtension } from "../../../../engine/contracts/types/extension";
import { extensionCompatibilityStatus } from "../../../../engine/contracts/extension-compatibility";
import { currentRuntimeConsentScope } from "../../../../shared/api/customization-api";
import {
  EXTENSION_CONSENT_CHANGED_EVENT,
  extensionConsentFingerprint,
  extensionDeviceConsentStore,
  type ExtensionDeviceConsent,
} from "../../../../shared/lib/extension-device-consent";

export async function resolveExtensionDeviceActivation(extension: InstalledExtension) {
  const fingerprint = await extensionConsentFingerprint(extension);
  return {
    fingerprint,
    consent: extensionDeviceConsentStore.read(currentRuntimeConsentScope(), extension.id, fingerprint),
  };
}

export function useExtensionDeviceActivation(extension: InstalledExtension | null) {
  const [resolved, setResolved] = useState<{ fingerprint: string; consent: ExtensionDeviceConsent | null } | null>(null);
  const [revision, setRevision] = useState(0);
  let compatibility: "compatible" | "incompatible" | "not-declared" = "not-declared";
  try {
    compatibility = extensionCompatibilityStatus(extension?.compatibility?.deKoi);
  } catch {
    compatibility = "incompatible";
  }

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    globalThis.addEventListener(EXTENSION_CONSENT_CHANGED_EVENT, refresh);
    return () => globalThis.removeEventListener(EXTENSION_CONSENT_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (extension) {
      void resolveExtensionDeviceActivation(extension).then((value) => {
        if (!cancelled) setResolved(value);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [extension, revision]);

  const grant = useCallback(
    (activation: { css: boolean; javascript: boolean }) => {
      if (!extension || !resolved || compatibility === "incompatible") return false;
      extensionDeviceConsentStore.grant(
        currentRuntimeConsentScope(),
        extension.id,
        resolved.fingerprint,
        activation,
      );
      return true;
    },
    [compatibility, extension, resolved],
  );
  const revoke = useCallback(() => {
    if (extension) extensionDeviceConsentStore.revoke(currentRuntimeConsentScope(), extension.id);
  }, [extension]);

  return { compatibility, fingerprint: resolved?.fingerprint ?? null, consent: resolved?.consent ?? null, grant, revoke };
}
