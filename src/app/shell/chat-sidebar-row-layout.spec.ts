import { describe, expect, it } from "vitest";

import { CHAT_ROW_TITLE_CLASS_NAME } from "./chat-sidebar-row-layout";

describe("chat sidebar row layout", () => {
  it("lets the title lane use the available row width", () => {
    expect(CHAT_ROW_TITLE_CLASS_NAME).toContain("min-w-0");
    expect(CHAT_ROW_TITLE_CLASS_NAME).toContain("flex-1");
  });
});
