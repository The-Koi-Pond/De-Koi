import { beforeEach, describe, expect, it } from "vitest";
import { extensionDeviceConsentStore } from "../../../../shared/lib/extension-device-consent";
import { currentRuntimeConsentScope } from "../../../../shared/api/customization-api";
import { resolveExtensionDeviceActivation } from "./use-extension-device-activation";

describe("extension device activation", () => {
  beforeEach(() => localStorage.clear());
  it("does not infer local activation from a shared enabled row", async () => {
    const extension = { id: "shared", enabled: true, permissions: [] } as never;
    const resolved = await resolveExtensionDeviceActivation(extension);
    expect(resolved.consent).toBeNull();
    extensionDeviceConsentStore.grant(currentRuntimeConsentScope(), "shared", resolved.fingerprint, { css: true, javascript: false });
    expect((await resolveExtensionDeviceActivation(extension)).consent?.css).toBe(true);
  });
});
