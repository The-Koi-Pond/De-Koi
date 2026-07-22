import { describe, expect, it } from "vitest";
import {
  discoveryActionReplacesCenterSurface,
  getAppShellCenterSurfaceState,
  getSetupJourneyHost,
  shouldBeginSetupJourney,
} from "./app-shell-center-surfaces";

describe("Discover action ownership", () => {
  it("closes only when an action replaces the center surface", () => {
    expect(discoveryActionReplacesCenterSurface("open-showcase")).toBe(true);
    expect(discoveryActionReplacesCenterSurface("open-deki")).toBe(true);
    expect(discoveryActionReplacesCenterSurface("open-help")).toBe(false);
    expect(discoveryActionReplacesCenterSurface("open-discover")).toBe(false);
  });
});

describe("getAppShellCenterSurfaceState", () => {
  it("lets Deki occupy the center surface when no full-view surface is active and a session is selected", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: false,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: false,
        detailViewOpen: false,
        dekiOpen: true,
        activeDekiSessionId: "deki-1",
        discoverOpen: false,
      }),
    ).toEqual({
      discoverSurfaceVisible: false,
      dekiSurfaceVisible: true,
      mainSurfaceVisible: false,
    });
  });

  it("keeps the main surface visible when only the Deki sidebar is opened", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: false,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: false,
        detailViewOpen: false,
        dekiOpen: false,
        activeDekiSessionId: null,
        discoverOpen: false,
      }),
    ).toEqual({
      discoverSurfaceVisible: false,
      dekiSurfaceVisible: false,
      mainSurfaceVisible: true,
    });
  });

  it("gives full-view surfaces priority over an open Deki panel", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: true,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: false,
        detailViewOpen: false,
        dekiOpen: true,
        activeDekiSessionId: "deki-1",
        discoverOpen: false,
      }),
    ).toEqual({
      discoverSurfaceVisible: false,
      dekiSurfaceVisible: false,
      mainSurfaceVisible: false,
    });
  });

  it("keeps right sidebar panels reachable while Deki is open", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: false,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: true,
        detailViewOpen: false,
        dekiOpen: true,
        activeDekiSessionId: "deki-1",
        discoverOpen: false,
      }),
    ).toEqual({
      discoverSurfaceVisible: false,
      dekiSurfaceVisible: false,
      mainSurfaceVisible: true,
    });
  });

  it("shows detail views instead of Deki when both are open", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: false,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: false,
        detailViewOpen: true,
        dekiOpen: true,
        activeDekiSessionId: "deki-1",
        discoverOpen: false,
      }),
    ).toEqual({
      discoverSurfaceVisible: false,
      dekiSurfaceVisible: false,
      mainSurfaceVisible: true,
    });
  });

  it("shows Discover as a dedicated center surface until Home or browser back closes it", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: false,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: false,
        detailViewOpen: false,
        dekiOpen: false,
        activeDekiSessionId: null,
        discoverOpen: true,
      }),
    ).toEqual({ discoverSurfaceVisible: true, dekiSurfaceVisible: false, mainSurfaceVisible: false });
  });

  it("keeps Discover visible while a right sidebar panel is open", () => {
    expect(
      getAppShellCenterSurfaceState({
        botBrowserOpen: false,
        gameAssetsBrowserOpen: false,
        rightPanelOpen: true,
        detailViewOpen: false,
        dekiOpen: false,
        activeDekiSessionId: null,
        discoverOpen: true,
      }),
    ).toEqual({ discoverSurfaceVisible: true, dekiSurfaceVisible: false, mainSurfaceVisible: false });
  });
});

describe("getSetupJourneyHost", () => {
  it("keeps setup inline only on the visible Home surface", () => {
    expect(getSetupJourneyHost({ activeChatId: null, detailViewOpen: false, mainSurfaceVisible: true })).toBe("home");
  });

  it.each([
    { label: "active chat", activeChatId: "chat-1", detailViewOpen: false, mainSurfaceVisible: true },
    { label: "detail view", activeChatId: null, detailViewOpen: true, mainSurfaceVisible: true },
    { label: "full-view overlay", activeChatId: null, detailViewOpen: false, mainSurfaceVisible: false },
  ])("uses the shell host for $label", ({ activeChatId, detailViewOpen, mainSurfaceVisible }) => {
    expect(getSetupJourneyHost({ activeChatId, detailViewOpen, mainSurfaceVisible })).toBe("shell");
  });
});

describe("shouldBeginSetupJourney", () => {
  it("bridges every pending mode, including Game, when no active journey owns it", () => {
    expect(shouldBeginSetupJourney("conversation", null)).toBe(true);
    expect(shouldBeginSetupJourney("roleplay", null)).toBe(true);
    expect(shouldBeginSetupJourney("game", null)).toBe(true);
    expect(shouldBeginSetupJourney("game", { mode: "game", completed: false })).toBe(false);
    expect(shouldBeginSetupJourney("game", { mode: "game", completed: true })).toBe(true);
  });
});

describe("automatic memory capture notification policy", () => {
  it("returns exact capture feedback only while the preference is enabled", async () => {
    const module = (await import("./app-shell-center-surfaces")) as Record<string, unknown>;
    expect(module).toHaveProperty("getAutomaticMemoryCaptureToast");

    const getAutomaticMemoryCaptureToast = module.getAutomaticMemoryCaptureToast as (
      enabled: boolean,
      completion: { operation: "created" | "updated"; memory: { content: string } },
    ) => { title: string; description: string } | null;
    const completion = { operation: "created" as const, memory: { content: "Celia's cat is named Miso." } };

    expect(getAutomaticMemoryCaptureToast(false, completion)).toBeNull();
    expect(getAutomaticMemoryCaptureToast(true, completion)).toEqual({
      title: "Memory saved",
      description: "Celia's cat is named Miso.",
    });
    expect(getAutomaticMemoryCaptureToast(true, { ...completion, operation: "updated" })).toEqual({
      title: "Memory updated",
      description: "Celia's cat is named Miso.",
    });
  });
});
