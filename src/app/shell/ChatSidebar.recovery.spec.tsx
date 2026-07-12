import { describe, expect, it, vi } from "vitest";
import { runChatSidebarRecoveryAction } from "./ChatSidebar";

function dependencies() {
  return {
    retry: vi.fn(),
    create: vi.fn(),
    clearFilters: vi.fn(),
    connectServer: vi.fn(),
    openConnections: vi.fn(),
    viewHealth: vi.fn(),
    copySupportDetails: vi.fn(),
  };
}

describe("runChatSidebarRecoveryAction", () => {
  it.each([
    ["retry", "retry"],
    ["create", "create"],
    ["clear-filters", "clearFilters"],
    ["connect-server", "connectServer"],
    ["open-connections", "openConnections"],
    ["view-health", "viewHealth"],
    ["copy-support-details", "copySupportDetails"],
  ] as const)("maps %s only at the component edge", (actionId, dependency) => {
    const actions = dependencies();

    runChatSidebarRecoveryAction(actionId, actions);

    expect(actions[dependency]).toHaveBeenCalledOnce();
    expect(Object.values(actions).filter((action) => action.mock.calls.length > 0)).toHaveLength(1);
  });
});
