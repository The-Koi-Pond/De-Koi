import { beforeEach, describe, expect, it } from "vitest";
import type { InstalledExtension } from "../../engine/contracts/types/extension";
import { extensionConsentFingerprint, extensionDeviceConsentStore } from "./extension-device-consent";

const extension = {
  id: "pond",
  name: "Pond",
  description: "",
  enabled: true,
  js: "console.log('pond')",
  installedAt: "2026-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as InstalledExtension;

describe("extension device consent", () => {
  beforeEach(() => localStorage.clear());

  it("is isolated per runtime and invalidated by executable changes", async () => {
    const fingerprint = await extensionConsentFingerprint(extension);
    extensionDeviceConsentStore.grant("embedded", extension.id, fingerprint, { css: false, javascript: true });

    expect(extensionDeviceConsentStore.read("embedded", extension.id, fingerprint)?.javascript).toBe(true);
    expect(extensionDeviceConsentStore.read("remote:https://pond.test", extension.id, fingerprint)).toBeNull();
    expect(extensionDeviceConsentStore.read("embedded", extension.id, await extensionConsentFingerprint({ ...extension, js: "changed" }))).toBeNull();
  });

  it("fails closed for malformed storage", async () => {
    localStorage.setItem("de-koi.extension-device-consent.v1", "not-json");
    expect(extensionDeviceConsentStore.read("embedded", extension.id, await extensionConsentFingerprint(extension))).toBeNull();
  });
});
