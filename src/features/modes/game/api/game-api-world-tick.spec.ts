import { describe, expect, it } from "vitest";
import {
  buildWorldTickTriggerKey,
  worldTickHistoryFromMeta,
  WORLD_TICK_HISTORY_LIMIT,
} from "./game-api-world-tick";

describe("game-api-world-tick helpers", () => {
  it("reads only valid world tick history entries and keeps the latest bounded set", () => {
    const history = Array.from({ length: WORLD_TICK_HISTORY_LIMIT + 2 }, (_, index) => ({
      trigger: "manual",
      triggerKey: `manual:${index}`,
      ranAt: `2026-06-22T12:${String(index).padStart(2, "0")}:00.000Z`,
      recap: `Tick ${index}`,
      time: { day: 1, hour: 8, minute: index },
      dayChanged: false,
      weatherIntent: null,
    }));

    const result = worldTickHistoryFromMeta({
      gameWorldTickHistory: [
        { trigger: "manual", triggerKey: "", ranAt: "bad" },
        ...history,
        null,
        "not-history",
      ],
    });

    expect(result).toHaveLength(WORLD_TICK_HISTORY_LIMIT);
    expect(result[0]?.triggerKey).toBe("manual:2");
    expect(result.at(-1)?.triggerKey).toBe(`manual:${WORLD_TICK_HISTORY_LIMIT + 1}`);
  });

  it("builds stable automatic trigger keys from chat, session, trigger, and discriminator", () => {
    expect(
      buildWorldTickTriggerKey({
        chatId: "chat-1",
        trigger: "session_end",
        sessionNumber: 3,
        discriminator: "concluded",
      }),
    ).toBe("session_end:chat-1:session-3:concluded");
  });
});
