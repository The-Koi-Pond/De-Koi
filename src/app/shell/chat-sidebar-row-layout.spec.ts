import { describe, expect, it } from "vitest";

import { CHAT_ROW_ACTION_RAIL_CLASS_NAME, CHAT_ROW_TITLE_CLASS_NAME } from "./chat-sidebar-row-layout";

describe("chat sidebar row layout", () => {
  it("keeps hover actions out of the flex title measurement", () => {
    expect(CHAT_ROW_ACTION_RAIL_CLASS_NAME).toContain("absolute");
    expect(CHAT_ROW_ACTION_RAIL_CLASS_NAME).toContain("right-2");
  });

  it("lets the title lane use the available row width", () => {
    expect(CHAT_ROW_TITLE_CLASS_NAME).toContain("min-w-0");
    expect(CHAT_ROW_TITLE_CLASS_NAME).toContain("flex-1");
  });
});
