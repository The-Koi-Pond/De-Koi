import { useCallback, useEffect, useState } from "react";
import type { InstalledExtension } from "../../../../engine/contracts/types/extension";
import {
  extensionCompatibilityAllowsActivation,
  extensionCompatibilityStatus,
} from "../../../../engine/contracts/extension-compatibility";
import { currentRuntimeConsentScope } from "../../../../shared/api/customization-api";
import {
  EXTENSION_CONSENT_CHANGED_EVENT,
  extensionConsentEventAffects,
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
  let canActivate = false;
  try {
    compatibility = extensionCompatibilityStatus(extension?.compatibility?.deKoi);
    canActivate = extension ? extensionCompatibilityAllowsActivation(extension) : false;
  } catch {
    compatibility = "incompatible";
    canActivate = false;
  }

  useEffect(() => {
    const refresh = (event: Event) => {
      if (
        extension &&
        extensionConsentEventAffects(event, currentRuntimeConsentScope(), extension.id)
      ) {
        setRevision((value) => value + 1);
      }
    };
    globalThis.addEventListener(EXTENSION_CONSENT_CHANGED_EVENT, refresh);
    return () => globalThis.removeEventListener(EXTENSION_CONSENT_CHANGED_EVENT, refresh);
  }, [extension]);

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
      if (!extension || !resolved || !canActivate) return false;
      extensionDeviceConsentStore.grant(
        currentRuntimeConsentScope(),
        extension.id,
        resolved.fingerprint,
        activation,
      );
      return true;
    },
    [canActivate, extension, resolved],
  );
  const revoke = useCallback(() => {
    if (extension) extensionDeviceConsentStore.revoke(currentRuntimeConsentScope(), extension.id);
  }, [extension]);

  return {
    compatibility,
    canActivate,
    fingerprint: resolved?.fingerprint ?? null,
    consent: resolved?.consent ?? null,
    grant,
    revoke,
  };
}
