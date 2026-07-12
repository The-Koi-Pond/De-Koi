import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { runDiscoveryAction } from "./discovery-actions";

describe("settings discovery actions", () => {
  beforeEach(() => useUIStore.setState({ rightPanelOpen: false, settingsTab: "general", pendingSettingsDestination: null }));

  it("opens Settings at a stable destination", () => {
    runDiscoveryAction({ type: "open-settings", tab: "appearance", destination: "notification-sounds" });

    expect(useUIStore.getState()).toMatchObject({
      rightPanelOpen: true,
      rightPanel: "settings",
      settingsTab: "appearance",
      pendingSettingsDestination: "notification-sounds",
    });
  });
});
