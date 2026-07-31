// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const maintenanceHost = vi.hoisted(() => vi.fn(() => null));

vi.mock("./automatic-memory-maintenance", () => ({
  AutomaticMemoryMaintenanceHost: maintenanceHost,
}));

import { AutomaticMemoryMaintenanceStartup } from "./AutomaticMemoryMaintenanceStartup";

describe("automatic memory maintenance startup", () => {
  afterEach(() => {
    maintenanceHost.mockClear();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("does not start the maintenance worker until the browser is idle", async () => {
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(<AutomaticMemoryMaintenanceStartup />));
    expect(maintenanceHost).not.toHaveBeenCalled();

    await act(async () => {
      idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
      await Promise.resolve();
    });

    expect(maintenanceHost).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
