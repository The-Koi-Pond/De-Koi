import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatSidebarRecoveryView, runChatSidebarRecoveryAction } from "./ChatSidebar";

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

describe("ChatSidebarRecoveryView", () => {
  it.each([
    [{ title: "Chats could not be loaded", description: "Unknown failure.", primaryAction: { id: "retry", label: "Retry" }, secondaryAction: { id: "view-health", label: "View Health" } }, "retry"],
    [{ title: "No matching chats", description: "Filtered.", primaryAction: { id: "clear-filters", label: "Clear filters" } }, "clear-filters"],
    [{ title: "No games yet", description: "Empty.", primaryAction: { id: "create", label: "New Game" } }, "create"],
  ] as const)("renders and invokes the owner callback for %s", (recovery, expected) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    const onAction = vi.fn();
    act(() => root.render(<ChatSidebarRecoveryView recovery={recovery} onAction={onAction} />));
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === recovery.primaryAction.label)!;
    if ("secondaryAction" in recovery && recovery.secondaryAction) expect(host.textContent).toContain(recovery.secondaryAction.label);
    act(() => button.click());
    expect(onAction).toHaveBeenCalledWith(expected);
    act(() => root.unmount());
  });
});
