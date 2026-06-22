import { describe, expect, it, vi } from "vitest";

import type { UserQuickReplyActionConfig } from "../../../../../shared/stores/ui.store";
import {
  buildUserQuickReplyMenuEntries,
  isUserQuickReplyVisible,
  resolveUserQuickReplyCommand,
} from "./custom-quick-replies";

const baseAction = {
  id: "action-1",
  label: "Guide",
  iconId: "wand",
  commandTemplate: "/guided steer toward the lighthouse",
  includeDraft: false,
  scope: "global",
  enabled: true,
} satisfies UserQuickReplyActionConfig;

function action(patch: Partial<UserQuickReplyActionConfig> = {}): UserQuickReplyActionConfig {
  return { ...baseAction, ...patch };
}

describe("custom quick replies", () => {
  it("resolves a static saved slash command", () => {
    const resolved = resolveUserQuickReplyCommand(action(), { draft: "ignored", quoteFormat: "straight" });

    expect(resolved).toEqual({
      commandLine: "/guided steer toward the lighthouse",
      invalidReason: null,
      requiresDraft: false,
    });
  });

  it("builds an executable menu entry for a valid saved command", async () => {
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const entries = buildUserQuickReplyMenuEntries({
      actions: [action({ label: "Help", commandTemplate: "/help" })],
      mode: "conversation",
      activeChatId: "chat-1",
      draft: "",
      quoteFormat: "straight",
      isStreaming: false,
      hasPendingAttachments: false,
      executeCommand,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.disabled).toBe(false);

    await entries[0]?.onSelect();

    expect(executeCommand).toHaveBeenCalledWith("/help", "Help failed");
  });

  it("disables unknown or non-slash command templates", () => {
    const entries = buildUserQuickReplyMenuEntries({
      actions: [
        action({ id: "plain", commandTemplate: "guided no slash" }),
        action({ id: "unknown", commandTemplate: "/notreal hi" }),
      ],
      mode: "conversation",
      activeChatId: "chat-1",
      draft: "hello",
      quoteFormat: "straight",
      isStreaming: false,
      hasPendingAttachments: false,
      executeCommand: vi.fn(),
    });

    expect(entries.map((entry) => entry.disabledReason)).toEqual([
      "Saved action must start with a slash command.",
      "Saved action uses an unknown slash command.",
    ]);
  });

  it("appends formatted draft text when includeDraft is enabled without a placeholder", () => {
    const resolved = resolveUserQuickReplyCommand(action({ commandTemplate: "/guided", includeDraft: true }), {
      draft: "  Go “left”  ",
      quoteFormat: "straight",
    });

    expect(resolved.commandLine).toBe('/guided Go "left"');
    expect(resolved.requiresDraft).toBe(true);
  });

  it("replaces draft placeholders while preserving template text", () => {
    const resolved = resolveUserQuickReplyCommand(
      action({
        commandTemplate: '/impersonate Keep this short: "{{draft}}"',
        includeDraft: true,
      }),
      { draft: "say hello", quoteFormat: "straight" },
    );

    expect(resolved.commandLine).toBe('/impersonate Keep this short: "say hello"');
  });

  it("filters global, mode, and chat scoped actions", () => {
    expect(isUserQuickReplyVisible(action({ scope: "global" }), { mode: "roleplay", activeChatId: "chat-2" })).toBe(
      true,
    );
    expect(
      isUserQuickReplyVisible(action({ scope: "mode", mode: "roleplay" }), {
        mode: "roleplay",
        activeChatId: "chat-2",
      }),
    ).toBe(true);
    expect(
      isUserQuickReplyVisible(action({ scope: "mode", mode: "conversation" }), {
        mode: "roleplay",
        activeChatId: "chat-2",
      }),
    ).toBe(false);
    expect(
      isUserQuickReplyVisible(action({ scope: "chat", chatId: "chat-1" }), {
        mode: "conversation",
        activeChatId: "chat-2",
      }),
    ).toBe(false);
  });

  it("reuses chat input disabled-state checks", () => {
    const entries = buildUserQuickReplyMenuEntries({
      actions: [action({ commandTemplate: "/guided {{draft}}", includeDraft: true })],
      mode: "conversation",
      activeChatId: "chat-1",
      draft: "",
      quoteFormat: "straight",
      isStreaming: true,
      hasPendingAttachments: true,
      executeCommand: vi.fn(),
    });

    expect(entries[0]?.disabled).toBe(true);
    expect(entries[0]?.disabledReason).toBe("Wait for the current stream to finish.");
  });
});
