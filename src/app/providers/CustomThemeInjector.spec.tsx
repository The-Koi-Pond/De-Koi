import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomThemeInjector } from "./CustomThemeInjector";

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
  });

  afterEach(() => {
    act(() => root.unmount());
    document.getElementById("marinara-custom-theme")?.remove();
    container.remove();
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
});
