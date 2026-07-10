import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../shared/stores/ui.store";
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

describe("SettingsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useUIStore.setState({ settingsTab: "general" });
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
});
