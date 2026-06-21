import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoleplayBackgroundLayer } from "./ChatRoleplaySurface";

vi.mock("../../../../shared/api/local-file-api", () => ({
  resolveManagedLocalAssetUrl: async (url: string | null | undefined) => url ?? null,
}));

async function flushBackgroundEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function backgroundImages(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".mari-background")).map(
    (element) => element.style.backgroundImage,
  );
}

describe("RoleplayBackgroundLayer", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it("drops the previous chat background immediately when a new chat has none", async () => {
    act(() => {
      root = createRoot(container!);
      root.render(<RoleplayBackgroundLayer activeChatId="chat-a" chatBackground="https://example.test/old-bg.png" />);
    });
    await flushBackgroundEffects();

    expect(backgroundImages(container!).some((image) => image.includes("old-bg.png"))).toBe(true);

    act(() => {
      root!.render(<RoleplayBackgroundLayer activeChatId="chat-b" chatBackground={null} />);
    });

    expect(backgroundImages(container!).some((image) => image.includes("old-bg.png"))).toBe(false);
  });
});
