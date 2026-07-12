import { beforeEach, describe, expect, it } from "vitest";
import { closeDiscoverHistory, openDiscoverHistory } from "./app-shell-discover-history";

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
});
