import { describe, expect, it } from "vitest";
import { getAppShellCenterSurfaceState } from "./app-shell-center-surfaces";

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
      }),
    ).toEqual({
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
      }),
    ).toEqual({
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
      }),
    ).toEqual({
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
      }),
    ).toEqual({
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
      }),
    ).toEqual({
      dekiSurfaceVisible: false,
      mainSurfaceVisible: true,
    });
  });
});
