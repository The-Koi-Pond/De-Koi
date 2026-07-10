import { describe, expect, it } from "vitest";
import { runDekiEntry, type DekiGateway } from "./deki-entry";

const input = { userMessage: "hello", messages: [] };

describe("runDekiEntry usage", () => {
  it("preserves normalized usage returned by the gateway", async () => {
    const gateway: DekiGateway = {
      async prompt() {
        return {
          content: "Hi!",
          createdAt: "2026-07-10T00:00:00.000Z",
          usage: {
            promptTokens: 10,
            completionTokens: 4,
            cachedPromptTokens: 3,
            cacheWritePromptTokens: null,
            totalTokens: 14,
          },
        };
      },
    };

    await expect(runDekiEntry(input, gateway)).resolves.toMatchObject({
      content: "Hi!",
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
  });

  it("normalizes absent gateway usage to null", async () => {
    const gateway: DekiGateway = {
      async prompt() {
        return { content: "Hi!", createdAt: "2026-07-10T00:00:00.000Z" };
      },
    };

    await expect(runDekiEntry(input, gateway)).resolves.toMatchObject({ usage: null });
  });
});
