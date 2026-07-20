import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_NOTIFICATION_ACTIVATION_EVENT,
  showLocalChatNotification,
  type LocalNotificationActivationDetail,
} from "./local-notifications";

const tauriNotificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted" as NotificationPermission),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => tauriNotificationMocks);

type NotificationClickHandler = ((event: Event) => void) | null;

describe("local chat notifications", () => {
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
  });

  it("focuses, closes, and dispatches the originating chat when a browser notification is clicked", async () => {
    let clickHandler: NotificationClickHandler = null;
    const close = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const activated: LocalNotificationActivationDetail[] = [];
    const handleActivation = (event: Event) => {
      activated.push((event as CustomEvent<LocalNotificationActivationDetail>).detail);
    };
    window.addEventListener(LOCAL_NOTIFICATION_ACTIVATION_EVENT, handleActivation);

    class NotificationMock {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      close = close;

      constructor(
        public title: string,
        public options?: NotificationOptions,
      ) {}

      set onclick(handler: NotificationClickHandler) {
        clickHandler = handler;
      }
    }

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.stubGlobal("Notification", NotificationMock);

    await showLocalChatNotification({
      enabled: true,
      chatId: "chat-42",
      characterName: "Rin",
      tag: "chat-42",
    });

    expect(clickHandler).not.toBeNull();
    clickHandler!(new Event("click"));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(activated).toEqual([{ chatId: "chat-42" }]);

    window.removeEventListener(LOCAL_NOTIFICATION_ACTIVATION_EVENT, handleActivation);
  });

  it.each([
    { caseName: "notifications are disabled", enabled: false, permission: "granted", visible: false, focused: false },
    { caseName: "De-Koi is focused", enabled: true, permission: "granted", visible: true, focused: true },
    { caseName: "permission is denied", enabled: true, permission: "denied", visible: false, focused: false },
  ] as const)("does not notify when $caseName", async ({ enabled, permission, visible, focused }) => {
    const construct = vi.fn();

    class NotificationMock {
      static permission: NotificationPermission = permission;
      static requestPermission = vi.fn(async () => permission);

      constructor() {
        construct();
      }
    }

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(focused);
    vi.stubGlobal("Notification", NotificationMock);

    const shown = await showLocalChatNotification({ enabled, chatId: "chat-42", characterName: "Rin" });

    expect(shown).toBe(false);
    expect(construct).not.toHaveBeenCalled();
  });

  it("uses the native notifier without inventing a desktop activation callback", async () => {
    window.__TAURI_INTERNALS__ = {};
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const activation = vi.fn();
    window.addEventListener(LOCAL_NOTIFICATION_ACTIVATION_EVENT, activation);

    const shown = await showLocalChatNotification({
      enabled: true,
      chatId: "roleplay-chat",
      characterName: "Rin",
      tag: "marinara-roleplay-roleplay-chat",
    });

    expect(shown).toBe(true);
    expect(tauriNotificationMocks.sendNotification).toHaveBeenCalledWith({
      title: "New message from Rin",
      body: "Open De-Koi to read it.",
      group: "marinara-roleplay-roleplay-chat",
      autoCancel: true,
    });
    expect(activation).not.toHaveBeenCalled();

    window.removeEventListener(LOCAL_NOTIFICATION_ACTIVATION_EVENT, activation);
  });

  it("requires every notification caller to supply the originating chat", () => {
    const callerPaths = [
      "src/features/runtime/generation/hooks/use-generate.ts",
      "src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts",
      "src/features/modes/conversation/components/ConversationView.tsx",
    ];

    for (const path of callerPaths) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).not.toContain("showConversationLocalNotification");
      const callOptions = source.match(/showLocalChatNotification\(\{([\s\S]*?)\}\)/)?.[1];
      expect(callOptions, path).toMatch(/\bchatId\s*[:,]/);
    }
  });

  it("describes the shared Conversation and Roleplay preference without renaming its persisted key", () => {
    const settingsSource = readFileSync(
      resolve(process.cwd(), "src/features/shell/settings/components/settings/SettingControls.tsx"),
      "utf8",
    );
    const persistenceSource = readFileSync(resolve(process.cwd(), "src/shared/stores/ui/persistence.ts"), "utf8");

    expect(settingsSource).toContain("when a Conversation or Roleplay character replies");
    expect(persistenceSource).toContain("conversationBrowserNotifications: state.conversationBrowserNotifications");
  });
});
