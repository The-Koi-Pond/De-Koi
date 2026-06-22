import { describe, expect, it, vi } from "vitest";

import type { UserQuickReplyActionConfig } from "../../../../shared/stores/ui.store";
import { buildGameUserQuickReplyMenuEntries } from "./game-user-quick-replies";

const baseAction = {
  id: "game-action",
  label: "Scout",
  iconId: "dices",
  commandTemplate: "/guided scout {{draft}}",
  includeDraft: true,
  scope: "mode",
  mode: "game",
  enabled: true,
} satisfies UserQuickReplyActionConfig;

function action(patch: Partial<UserQuickReplyActionConfig> = {}): UserQuickReplyActionConfig {
  return { ...baseAction, ...patch };
}

describe("buildGameUserQuickReplyMenuEntries", () => {
  it("executes Game-scoped saved slash commands as Game turns", async () => {
    const executeGameTurn = vi.fn().mockResolvedValue(undefined);
    const entries = buildGameUserQuickReplyMenuEntries({
      actions: [action()],
      activeChatId: "game-chat",
      draft: "the east door",
      quoteFormat: "straight",
      isStreaming: false,
      hasPendingGameTurnState: false,
      executeGameTurn,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.disabled).toBe(false);

    await entries[0]?.onSelect();

    expect(executeGameTurn).toHaveBeenCalledWith("/guided scout the east door", "Scout failed");
  });

  it("disables custom Game actions while queued Game turn state is pending", () => {
    const entries = buildGameUserQuickReplyMenuEntries({
      actions: [action()],
      activeChatId: "game-chat",
      draft: "the east door",
      quoteFormat: "straight",
      isStreaming: false,
      hasPendingGameTurnState: true,
      executeGameTurn: vi.fn(),
    });

    expect(entries[0]).toMatchObject({
      disabled: true,
      disabledReason: "Clear queued dice, movement, or attachments first.",
    });
  });
});