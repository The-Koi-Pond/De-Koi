import { describe, expect, it } from "vitest";
import { ApiError } from "../../shared/api/api-errors";
import {
  chatSidebarRetryNote,
  getChatSidebarRecovery,
  type ChatSidebarRecoveryActionId,
} from "./chat-sidebar-recovery";

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

  it.each([
    ["startup", ["retry", "view-health"], "startup"],
    ["missing-runtime", ["connect-server", "view-health"], "server"],
    ["unhealthy-runtime", ["view-health", "retry"], "reachability"],
    ["storage", ["view-health", "copy-support-details"], "storage"],
    ["connection", ["open-connections", "retry"], "provider"],
  ] as const)("keeps the exact ordered actions and category copy for %s", (kind, actions, copy) => {
    const recovery = getChatSidebarRecovery({ kind }, context);
    expect([recovery.primaryAction.id, recovery.secondaryAction?.id]).toEqual(actions);
    expect(`${recovery.title} ${recovery.description}`.toLowerCase()).toContain(copy);
  });

  it("shows the De-Koi server's own fix when the chat list can't reach it", () => {
    const unreachable = new ApiError("Can't reach the De-Koi server. Check that it's running.", 503, {
      code: "remote_runtime_unreachable",
    });
    const recovery = getChatSidebarRecovery(unreachable, context);
    expect(recovery.title).toBe("Can't load chats from the De-Koi server");
    expect(recovery.description).toBe(unreachable.message);
    expect(chatSidebarRetryNote(unreachable)).toBe(`Still trying to load chats. ${unreachable.message}`);

    const unconfigured = new ApiError("No De-Koi server address is set.", 400, { code: "remote_runtime_unconfigured" });
    expect(getChatSidebarRecovery(unconfigured, context).primaryAction.id).toBe("connect-server");

    // Ordinary failures keep the generic copy instead of showing internal text.
    expect(chatSidebarRetryNote(new ApiError("chats/x not found", 404))).toBe("Still trying to load chats…");
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
    ["fanfic", "New Fanfic"],
  ] as const)("creates the correct %s mode from a true empty list", (mode, label) => {
    const recovery = getChatSidebarRecovery(null, { mode, state: "empty", hasFilters: false });

    expect(recovery.primaryAction).toEqual({ id: "create", label });
  });
});
