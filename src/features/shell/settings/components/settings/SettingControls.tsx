import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { playNotificationPing } from "../../../../../shared/lib/notification-sound";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import {
  getLocalNotificationPermission,
  type LocalNotificationPermission,
  requestLocalNotificationPermission,
} from "../../../../../shared/lib/local-notifications";

export function ConversationSoundSetting() {
  const convoNotificationSound = useUIStore((s) => s.convoNotificationSound);
  const setConvoNotificationSound = useUIStore((s) => s.setConvoNotificationSound);
  const rpNotificationSound = useUIStore((s) => s.rpNotificationSound);
  const setRpNotificationSound = useUIStore((s) => s.setRpNotificationSound);
  const conversationBrowserNotifications = useUIStore((s) => s.conversationBrowserNotifications);
  const setConversationBrowserNotifications = useUIStore((s) => s.setConversationBrowserNotifications);
  const [localNotificationPermission, setLocalNotificationPermission] =
    useState<LocalNotificationPermission>("default");

  useEffect(() => {
    let cancelled = false;
    const syncPermission = () => {
      void getLocalNotificationPermission().then((permission) => {
        if (!cancelled) setLocalNotificationPermission(permission);
      });
    };

    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

  const nativeNotificationsChecked = conversationBrowserNotifications && localNotificationPermission === "granted";
  const nativeNotificationsHelp =
    localNotificationPermission === "unsupported"
      ? "This browser or app shell does not expose native notifications."
      : localNotificationPermission === "denied"
        ? "Notifications are blocked in the browser or operating system. Re-enable them in site or system settings to use this."
        : "Show a generic native notification when a Conversation-mode character replies while Marinara is not focused. Message contents are never shown.";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Bell size="0.75rem" className="text-[var(--muted-foreground)]" />
        <span className="text-xs font-medium">Notifications</span>
        <HelpTooltip text="Control local Conversation and Roleplay alerts. Native notifications only use generic copy and never include message contents." />
      </div>
      <ToggleSetting
        label="Conversation mode"
        checked={convoNotificationSound}
        onChange={(v) => {
          setConvoNotificationSound(v);
          if (v) playNotificationPing();
        }}
      />
      <ToggleSetting
        label="Native notifications"
        checked={nativeNotificationsChecked}
        disabled={localNotificationPermission === "unsupported" || localNotificationPermission === "denied"}
        onChange={async (v) => {
          if (!v) {
            setConversationBrowserNotifications(false);
            return;
          }
          const nextPermission = await requestLocalNotificationPermission();
          setLocalNotificationPermission(nextPermission);
          setConversationBrowserNotifications(nextPermission === "granted");
        }}
        help={nativeNotificationsHelp}
      />
      {localNotificationPermission === "default" && (
        <p className="pl-6 text-[0.625rem] leading-snug text-[var(--muted-foreground)]">
          Enabling this may open your system notification permission prompt.
        </p>
      )}
      {localNotificationPermission === "granted" && nativeNotificationsChecked && (
        <p className="pl-6 text-[0.625rem] leading-snug text-[var(--muted-foreground)]">
          Marinara will only notify while the app is unfocused.
        </p>
      )}
      <ToggleSetting
        label="Roleplay mode"
        checked={rpNotificationSound}
        onChange={(v) => {
          setRpNotificationSound(v);
          if (v) playNotificationPing();
        }}
      />
    </div>
  );
}

export function ToggleSetting({
  label,
  checked,
  onChange,
  help,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-[var(--secondary)]/50">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          void onChange(e.target.checked);
        }}
        className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span className="text-xs">{label}</span>
      {help && (
        <span onClick={(e) => e.preventDefault()}>
          <HelpTooltip text={help} />
        </span>
      )}
    </label>
  );
}
