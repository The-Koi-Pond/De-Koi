import { describe, expect, it } from "vitest";

import { CHAT_ROW_ACTION_RAIL_CLASS_NAME, CHAT_ROW_TITLE_CLASS_NAME } from "./chat-sidebar-row-layout";

describe("chat sidebar row layout", () => {
  it("docks hover actions as a shrinking flex rail", () => {
    expect(CHAT_ROW_ACTION_RAIL_CLASS_NAME).not.toContain("absolute");
    expect(CHAT_ROW_ACTION_RAIL_CLASS_NAME).toContain("ml-auto");
    expect(CHAT_ROW_ACTION_RAIL_CLASS_NAME).toContain("max-w-0");
    expect(CHAT_ROW_ACTION_RAIL_CLASS_NAME).toContain("group-hover:max-w-32");
  });

  it("lets the title lane use the available row width", () => {
    expect(CHAT_ROW_TITLE_CLASS_NAME).toContain("min-w-0");
    expect(CHAT_ROW_TITLE_CLASS_NAME).toContain("flex-1");
  });
});
