import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDiscoverHistory, openDiscoverHistory, useDiscoverHistoryLifecycle } from "./app-shell-discover-history";

describe("AppShell Discover history", () => {
  beforeEach(() => window.history.replaceState({ base: true }, "", "/"));

  it("pushes a dedicated marker and removes it when Back to Home explicitly closes Discover", () => {
    openDiscoverHistory(window.history, window.location.href);
    expect(window.history.state).toMatchObject({ deKoiDiscover: true });

    closeDiscoverHistory(window.history, window.location.href);

    expect(window.history.state).toEqual({ base: true });
    expect(window.history.state).not.toHaveProperty("deKoiDiscover");
  });

  it("does not alter unrelated history state when Discover is not current", () => {
    closeDiscoverHistory(window.history, window.location.href);
    expect(window.history.state).toEqual({ base: true });
  });

  it("mounts one popstate listener, handles back/forward, and removes it on close", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const close = vi.fn();
    function Harness({ open }: { open: boolean }) { useDiscoverHistoryLifecycle(open, close); return null; }
    const host = document.createElement("div"); const root = createRoot(host);
    act(() => root.render(createElement(Harness, { open: true })));
    expect(add.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(close).toHaveBeenCalledOnce();
    act(() => root.render(createElement(Harness, { open: false })));
    expect(remove.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1);
    act(() => root.unmount()); add.mockRestore(); remove.mockRestore();
  });
});
