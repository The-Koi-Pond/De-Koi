import { describe, expect, it } from "vitest";

import { LIBRARY_NAV_ITEMS, PRIMARY_NAV_ITEMS, SHELL_NAV_ITEMS, TOOLS_NAV_ITEMS } from "./shell-navigation";

describe("shell navigation registry", () => {
  it("groups every shell destination exactly once with a visible label", () => {
    const grouped = [...PRIMARY_NAV_ITEMS, ...LIBRARY_NAV_ITEMS, ...TOOLS_NAV_ITEMS];

    expect(grouped).toEqual(SHELL_NAV_ITEMS);
    expect(new Set(grouped.map((item) => item.destination)).size).toBe(grouped.length);
    expect(grouped.every((item) => item.label.trim().length > 0)).toBe(true);
  });

  it("keeps the required destinations in their intended groups", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual(["Chats", "Deki-senpai"]);
    expect(LIBRARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Browser",
      "Characters",
      "Personas",
      "Lorebooks",
      "Presets",
      "Gallery",
    ]);
    expect(TOOLS_NAV_ITEMS.map((item) => item.label)).toEqual(["Connections", "Agents", "Settings", "Discover"]);
  });
});
