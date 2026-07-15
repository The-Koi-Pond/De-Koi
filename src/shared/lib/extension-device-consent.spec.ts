import { beforeEach, describe, expect, it } from "vitest";
import type { InstalledExtension } from "../../engine/contracts/types/extension";
import {
  extensionConsentEventAffects,
  extensionConsentFingerprint,
  extensionDeviceConsentStore,
  sha256Hex,
} from "./extension-device-consent";

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
    expect(
      extensionDeviceConsentStore.read(
        "embedded",
        extension.id,
        await extensionConsentFingerprint({ ...extension, js: "changed" }),
      ),
    ).toBeNull();
  });

  it("fails closed for malformed storage", async () => {
    localStorage.setItem("de-koi.extension-device-consent.v1", "not-json");
    expect(
      extensionDeviceConsentStore.read("embedded", extension.id, await extensionConsentFingerprint(extension)),
    ).toBeNull();
  });

  it("keeps SHA-256 fingerprints available without Web Crypto", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"), null)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("keeps consent fingerprints identical across Web Crypto and the deterministic fallback", async () => {
    const input = new TextEncoder().encode("same package");
    expect(await sha256Hex(input)).toBe(await sha256Hex(input, null));
  });

  it("filters consent events by runtime and extension", () => {
    expect(extensionConsentEventAffects(new Event("change"), "embedded", "pond")).toBe(false);
    expect(extensionConsentEventAffects(new CustomEvent("change", { detail: {} }), "embedded", "pond")).toBe(false);
    expect(extensionConsentEventAffects(new CustomEvent("change", { detail: { all: true } }), "embedded", "pond")).toBe(
      true,
    );
    expect(
      extensionConsentEventAffects(
        new CustomEvent("change", { detail: { runtimeScope: "embedded", extensionId: "pond" } }),
        "embedded",
        "pond",
      ),
    ).toBe(true);
    expect(
      extensionConsentEventAffects(
        new CustomEvent("change", { detail: { runtimeScope: "embedded", extensionId: "other" } }),
        "embedded",
        "pond",
      ),
    ).toBe(false);
    expect(
      extensionConsentEventAffects(
        new CustomEvent("change", { detail: { runtimeScope: "remote:https://pond.test", extensionId: "pond" } }),
        "embedded",
        "pond",
      ),
    ).toBe(false);
  });
});
