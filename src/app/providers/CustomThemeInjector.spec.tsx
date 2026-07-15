import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomThemeInjector } from "./CustomThemeInjector";
import { extensionConsentFingerprint, extensionDeviceConsentStore } from "../../shared/lib/extension-device-consent";
import { currentRuntimeConsentScope } from "../../shared/api/customization-api";

const settingsData = vi.hoisted(() => ({
  themes: [] as Array<Record<string, unknown>>,
  extensions: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../features/shell/settings/index", () => ({
  useThemes: () => ({ data: settingsData.themes }),
  useExtensions: () => ({ data: settingsData.extensions }),
}));

describe("CustomThemeInjector", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    settingsData.themes = [];
    settingsData.extensions = [];
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.getElementById("marinara-custom-theme")?.remove();
    container.remove();
    document.querySelectorAll('style[id^="marinara-ext-"]').forEach((element) => element.remove());
  });

  it("does not inject oversized stored theme CSS", () => {
    settingsData.themes = [
      {
        id: "oversized",
        name: "Oversized",
        css: "x".repeat(256 * 1024 + 1),
        isActive: true,
      },
    ];

    act(() => root.render(<CustomThemeInjector />));

    expect(document.getElementById("marinara-custom-theme")).toBeNull();
  });

  it("requires matching device-local consent before injecting extension CSS", async () => {
    const extension = {
      id: "local-consent",
      name: "Local consent",
      description: "",
      css: ".local-consent { color: teal; }",
      enabled: true,
      installedAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    settingsData.extensions = [extension];

    await act(async () => {
      root.render(<CustomThemeInjector />);
      await Promise.resolve();
    });
    expect(document.getElementById("marinara-ext-local-consent")).toBeNull();

    extensionDeviceConsentStore.grant(
      currentRuntimeConsentScope(),
      extension.id,
      await extensionConsentFingerprint(extension as never),
      { css: true, javascript: false },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.getElementById("marinara-ext-local-consent")?.textContent).toContain("color: teal");
    });
  });
});
