import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GifPicker } from "./GifPicker";

const gifApiMock = vi.hoisted(() => ({
  config: vi.fn(),
  openApiKeyPage: vi.fn(),
  search: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("../../api/integration-utility-api", () => ({
  gifsApi: gifApiMock,
}));

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GifPicker", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    gifApiMock.search.mockRejectedValue(new Error("GIF search requires a GIPHY API key"));
    gifApiMock.config.mockResolvedValue({
      hasApiKey: false,
      apiKey: null,
      source: "missing",
      envConfigured: false,
    });
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
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not retry search or reload config while the missing-key setup panel is open", async () => {
    act(() => {
      root = createRoot(container!);
      root.render(<GifPicker open onClose={vi.fn()} onSelect={vi.fn()} />);
    });

    await flushAsyncWork();

    expect(gifApiMock.search).toHaveBeenCalledTimes(1);
    expect(gifApiMock.config).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("GIPHY key required");

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flushAsyncWork();

    expect(gifApiMock.search).toHaveBeenCalledTimes(1);
    expect(gifApiMock.config).toHaveBeenCalledTimes(1);
  });
});
