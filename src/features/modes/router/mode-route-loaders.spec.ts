import { describe, expect, it, vi } from "vitest";

import type { ChatMode } from "../../../engine/contracts/types/chat";
import { preloadModeRoute, type ModeRoutePreloaders } from "./mode-route-loaders";

describe("preloadModeRoute", () => {
  it.each(["conversation", "roleplay", "game"] as const)("loads only the %s route", async (mode: ChatMode) => {
    const loaders: ModeRoutePreloaders = {
      conversation: vi.fn(async () => undefined),
      roleplay: vi.fn(async () => undefined),
      game: vi.fn(async () => undefined),
    };

    await preloadModeRoute(mode, loaders);

    expect(loaders[mode]).toHaveBeenCalledOnce();
    for (const otherMode of ["conversation", "roleplay", "game"] as const) {
      if (otherMode !== mode) expect(loaders[otherMode]).not.toHaveBeenCalled();
    }
  });
});
