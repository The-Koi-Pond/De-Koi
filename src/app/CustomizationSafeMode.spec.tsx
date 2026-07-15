import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_CONSENT_STORAGE_KEY } from "../shared/lib/extension-device-consent";
import { CustomizationSafeMode } from "./CustomizationSafeMode";

const setActive = vi.hoisted(() => vi.fn());
vi.mock("../shared/api/customization-api", () => ({ themesApi: { setActive } }));

describe("CustomizationSafeMode", () => {
  beforeEach(() => {
    localStorage.clear();
    setActive.mockReset();
  });

  it("clears device activation even when remote theme deactivation fails", async () => {
    localStorage.setItem(EXTENSION_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, records: { unsafe: {} } }));
    setActive.mockRejectedValue(new Error("runtime offline"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CustomizationSafeMode />));

    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(localStorage.getItem(EXTENSION_CONSENT_STORAGE_KEY)).toBeNull();
    expect(container.textContent).toContain("extension activations were disabled");
    expect(container.textContent).toContain("active theme could not be disabled");
    act(() => root.unmount());
    container.remove();
  });
});
