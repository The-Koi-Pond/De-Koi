import { describe, expect, it } from "vitest";
import { getChatSidebarRecovery, type ChatSidebarRecoveryActionId } from "./chat-sidebar-recovery";

const context = { mode: "conversation" as const, state: "error" as const };

describe("getChatSidebarRecovery", () => {
  it.each<[{ kind: string }, ChatSidebarRecoveryActionId]>([
    [{ kind: "startup" }, "retry"],
    [{ kind: "missing-runtime" }, "connect-server"],
    [{ kind: "unhealthy-runtime" }, "view-health"],
    [{ kind: "storage" }, "view-health"],
    [{ kind: "connection" }, "open-connections"],
  ])("gives %s failures a relevant recovery action", (error, expectedAction) => {
    const recovery = getChatSidebarRecovery(error, context);

    expect([recovery.primaryAction.id, recovery.secondaryAction?.id]).toContain(expectedAction);
    expect(recovery.title).not.toHaveLength(0);
    expect(recovery.description).not.toHaveLength(0);
  });

  it("keeps opaque failures unknown and routes them to retry and health", () => {
    const recovery = getChatSidebarRecovery(new Error("storage runtime connection failed"), context);
    const copy = `${recovery.title} ${recovery.description}`.toLowerCase();

    expect(recovery.primaryAction.id).toBe("retry");
    expect(recovery.secondaryAction?.id).toBe("view-health");
    expect(copy).not.toContain("waking up");
    expect(copy).not.toContain("should appear");
    expect(copy).not.toContain("storage");
    expect(copy).not.toContain("connection");
  });

  it("clears filters when chats exist outside the current filter", () => {
    const recovery = getChatSidebarRecovery(null, {
      mode: "roleplay",
      state: "empty",
      hasFilters: true,
    });

    expect(recovery.primaryAction).toEqual({ id: "clear-filters", label: "Clear filters" });
  });

  it.each([
    ["conversation", "New Conversation"],
    ["roleplay", "New Roleplay"],
    ["game", "New Game"],
  ] as const)("creates the correct %s mode from a true empty list", (mode, label) => {
    const recovery = getChatSidebarRecovery(null, { mode, state: "empty", hasFilters: false });

    expect(recovery.primaryAction).toEqual({ id: "create", label });
  });
});
