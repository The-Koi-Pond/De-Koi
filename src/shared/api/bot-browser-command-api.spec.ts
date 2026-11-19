import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeTauri = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock("./tauri-client", () => ({ invokeTauri }));

import { botBrowserCommandApi, botBrowserPath } from "./bot-browser-command-api";

describe("bot browser command wrapper", () => {
  beforeEach(() => invokeTauri.mockClear());

  it("adds the /bot-browser/ prefix to bare paths and keeps prefixed ones", () => {
    expect(botBrowserPath("chub/search?q=")).toBe("/bot-browser/chub/search?q=");
    expect(botBrowserPath("/chub/search?q=")).toBe("/bot-browser/chub/search?q=");
    expect(botBrowserPath("/bot-browser/chub/avatar/a/b")).toBe("/bot-browser/chub/avatar/a/b");
    expect(botBrowserPath("bot-browser/datacat/tags")).toBe("/bot-browser/datacat/tags");
  });

  it("calls bot_browser_get with the path", async () => {
    await botBrowserCommandApi.get("pygmalion/session");
    expect(invokeTauri).toHaveBeenCalledWith("bot_browser_get", { path: "/bot-browser/pygmalion/session" });
  });

  it("calls bot_browser_post with the body, or null when there is none", async () => {
    await botBrowserCommandApi.post("pygmalion/set-token", { token: "abc" });
    await botBrowserCommandApi.post("pygmalion/logout");
    expect(invokeTauri).toHaveBeenNthCalledWith(1, "bot_browser_post", {
      path: "/bot-browser/pygmalion/set-token",
      body: { token: "abc" },
    });
    expect(invokeTauri).toHaveBeenNthCalledWith(2, "bot_browser_post", {
      path: "/bot-browser/pygmalion/logout",
      body: null,
    });
  });
});
