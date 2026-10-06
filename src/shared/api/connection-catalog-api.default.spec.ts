import { describe, expect, it } from "vitest";

import { connectionCatalogApi } from "./connection-catalog-api";

const { recentChatConnectionIds, selectDefaultTextConnectionId } = connectionCatalogApi;

const connections = [
  { id: "broken-first", provider: "custom" },
  { id: "claude", provider: "claude_subscription" },
  { id: "nano", provider: "nanogpt" },
];

describe("default text connection", () => {
  it("prefers the connection marked default", () => {
    expect(
      selectDefaultTextConnectionId(
        [...connections, { id: "marked", provider: "openai", isDefault: true }],
        ["claude"],
      ),
    ).toBe("marked");
  });

  it("falls back to the most recently used connection instead of the first one", () => {
    expect(selectDefaultTextConnectionId(connections, ["claude", "nano"])).toBe("claude");
  });

  it("skips recent connections that no longer exist", () => {
    expect(selectDefaultTextConnectionId(connections, ["deleted", "nano"])).toBe("nano");
  });

  it("keeps the first connection when there is no usage history", () => {
    expect(selectDefaultTextConnectionId(connections)).toBe("broken-first");
  });

  it("orders recency by set-up chats only, newest first", () => {
    expect(
      recentChatConnectionIds([
        { connectionId: "nano", updatedAt: "2026-10-01T00:00:00.000Z", characterIds: ["a"] },
        { connectionId: "broken-first", updatedAt: "2026-10-06T12:00:00.000Z", characterIds: [] },
        { connectionId: "claude", updatedAt: "2026-10-05T00:00:00.000Z", characterIds: ["b"] },
        { connectionId: "nano", updatedAt: "2026-10-04T00:00:00.000Z", characterIds: ["c"] },
      ]),
    ).toEqual(["claude", "nano"]);
  });
});
