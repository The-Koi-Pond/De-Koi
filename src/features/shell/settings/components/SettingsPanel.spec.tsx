import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../shared/stores/ui.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { SetupReadinessChecklist } from "../../onboarding/shell";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../../diagnostics/shell", () => ({ HealthDiagnosticsSettings: () => <div>Health surface</div> }));
vi.mock("../../plugins/settings", () => ({ CoreModulesSettings: () => <div>Modules surface</div> }));
vi.mock("./settings/SettingsSurfaces", () => ({
  GeneralSettings: () => <div>General surface</div>,
  AppearanceSettings: () => <div>Appearance surface</div>,
  ThemesSettings: () => <div>Themes surface</div>,
  ExtensionsSettings: () => <div>Extensions surface</div>,
  ImportSettings: () => <div>Import surface</div>,
  AdvancedSettings: () => <div>Advanced surface</div>,
}));
vi.mock("./settings/PrivacyDataSettings", () => ({ PrivacyDataSettings: () => <div>Privacy surface</div> }));

describe("SettingsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useUIStore.setState({ settingsTab: "general" });
    useSetupJourneyStore.setState({ intent: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
      root.render(<SettingsPanel />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses its own width for the descriptive navigation layout", () => {
    const panel = container.querySelector(".de-koi-settings-panel")!;
    const layout = container.querySelector(".de-koi-settings-layout")!;
    const tablist = container.querySelector('[role="tablist"]')!;

    expect(container.querySelector("h2")?.textContent).toBe("General");
    expect(container.textContent).toContain("Everyday behavior, message controls, and generation defaults.");
    expect(panel.className).toContain("@container");
    expect(layout.className).toContain("@3xl:grid-cols-[14rem_minmax(0,1fr)]");
    expect(tablist.className).toContain("@3xl:flex-col");
    expect(tablist.className).not.toContain("lg:flex-col");
  });

  it("shows full tab labels and updates the page introduction on selection", () => {
    const appearance = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Appearance"),
    )!;

    expect(appearance.textContent).toContain("Appearance");
    act(() => appearance.click());

    expect(useUIStore.getState().settingsTab).toBe("appearance");
    expect(container.querySelector("h2")?.textContent).toBe("Appearance");
    expect(container.textContent).toContain("Text, chat surfaces, roleplay art, and visual comfort.");
  });

  it("exposes privacy and data controls as a first-class settings surface", () => {
    const privacy = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Privacy & Data"),
    )!;

    act(() => privacy.click());

    expect(useUIStore.getState().settingsTab).toBe("privacy");
    expect(container.querySelector("h2")?.textContent).toBe("Privacy & Data");
    expect(container.textContent).toContain("Understand, export, and permanently erase De-Koi-managed data.");
    expect(container.textContent).toContain("Privacy surface");
  });

  it("keeps arrow-key tab navigation and focus behavior", async () => {
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    act(() => {
      tabs[0]!.focus();
      tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(useUIStore.getState().settingsTab).toBe("appearance");
    expect(document.activeElement?.id).toBe("settings-tab-appearance");
  });

  it("routes the runtime checklist action into Advanced Settings context and restores runtime focus", async () => {
    useSetupJourneyStore.getState().begin("conversation");
    function RuntimeOwnerHarness() {
      const open = useUIStore((state) => state.rightPanelOpen && state.rightPanel === "settings");
      return <><SetupReadinessChecklist facts={{ environment: "web", runtimeUrl: null, runtimeHealth: "unknown", usableConnectionCount: 0, selectedConnectionTest: "not-selected" }} onConfigureRuntime={() => {
        useUIStore.getState().setSettingsTab("advanced"); useUIStore.getState().openRightPanel("settings");
      }} />{open && <SettingsPanel />}</>;
    }
    act(() => root.render(<RuntimeOwnerHarness />));
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Configure server"))!.click());
    expect(useUIStore.getState().settingsTab).toBe("advanced");
    expect(container.textContent).toContain("Advanced surface");
    expect(container.textContent).toContain("Connect your De-Koi server to continue setup");
    expect(container.querySelector('[data-setup-focus="runtime"]')).toBeTruthy();
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Return to setup"))!.click());
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement?.id).toBe("setup-step-runtime");
  });
});
