// ──────────────────────────────────────────────
// Floating avatar notification bubbles
// ──────────────────────────────────────────────
// When a character messages in another conversation, their avatar appears
// as a floating circle on the right edge of the main content area.
// Click → navigate to that conversation. X → dismiss.
// On mobile, multiple notifications collapse into a single tappable group.

import { useState } from "react";
import { X, MessageCircle } from "lucide-react";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useNavigateToChatFromShell } from "../../actions";
import { cn, type AvatarCropValue } from "../../../../shared/lib/utils";
import { AvatarImage } from "../../../../shared/components/ui/AvatarImage";
import { motionStyle, SPRING_EASE } from "../../../../shared/lib/motion";
import { usePresence } from "../../../../shared/hooks/use-presence";

// Bubbles slide in from the right edge with a small overshoot and slide back out.
const BUBBLE_EXIT_MS = 200;
const BUBBLE_MOTION = motionStyle({
  from: { x: 60, scale: 0.8 },
  to: { x: 60, scale: 0.8 },
  durationMs: 350,
  ease: SPRING_EASE,
  exitDurationMs: BUBBLE_EXIT_MS,
});
const COLLAPSED_GROUP = "collapsed-group";

export function ChatNotificationBubbles() {
  const chatNotifications = useChatStore((s) => s.chatNotifications);
  const dismissNotification = useChatStore((s) => s.dismissNotification);
  const navigateToChat = useNavigateToChatFromShell();
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const notifications = Array.from(chatNotifications.values());
  const totalCount = notifications.reduce((sum, n) => sum + n.count, 0);
  const desktopBubbles = usePresence(notifications, (notif) => notif.chatId, BUBBLE_EXIT_MS);
  const mobileItems: Array<(typeof notifications)[number] | typeof COLLAPSED_GROUP> =
    notifications.length === 0 ? [] : notifications.length === 1 || mobileExpanded ? notifications : [COLLAPSED_GROUP];
  const mobileBubbles = usePresence(
    mobileItems,
    (item) => (item === COLLAPSED_GROUP ? COLLAPSED_GROUP : item.chatId),
    BUBBLE_EXIT_MS,
  );

  return (
    <div className="pointer-events-none absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-end gap-3">
      {/* ── Desktop: always show all bubbles ── */}
      <div className="hidden md:flex md:flex-col md:gap-3">
        {desktopBubbles.map(({ key, item: notif, exiting }) => (
          <NotificationBubble
            key={key}
            notif={notif}
            exiting={exiting}
            onNavigate={() => navigateToChat(notif.chatId)}
            onDismiss={() => dismissNotification(notif.chatId)}
          />
        ))}
      </div>

      {/* ── Mobile: collapsed or expanded ── */}
      <div className="flex flex-col items-end gap-2 md:hidden">
        {mobileBubbles.map(({ key, item, exiting }) =>
          item !== COLLAPSED_GROUP ? (
            /* Individual bubbles */
            <NotificationBubble
              key={key}
              notif={item}
              exiting={exiting}
              onNavigate={() => {
                navigateToChat(item.chatId);
                setMobileExpanded(false);
              }}
              onDismiss={() => {
                dismissNotification(item.chatId);
                if (notifications.length <= 2) setMobileExpanded(false);
              }}
            />
          ) : (
            /* Collapsed: stacked avatar preview → tap to expand */
            <button
              key={key}
              className={cn(exiting ? "motion-exit" : "motion-enter", "pointer-events-auto relative h-12 w-12")}
              style={BUBBLE_MOTION}
              onClick={() => setMobileExpanded(true)}
              title={`${notifications.length} conversations`}
            >
              {/* Stacked circles (max 3 visible) */}
              {notifications.slice(0, 3).map((notif, i) => (
                <div
                  key={notif.chatId}
                  className={cn(
                    "absolute flex h-10 w-10 items-center justify-center overflow-hidden rounded-full",
                    "bg-[var(--accent)]/20 ring-2 ring-[var(--background)]",
                  )}
                  style={{
                    top: i * 5,
                    right: i * 5,
                    zIndex: 3 - i,
                  }}
                >
                  {notif.avatarUrl ? (
                    <AvatarImage src={notif.avatarUrl} alt="" crop={notif.avatarCrop} />
                  ) : (
                    <MessageCircle className="h-4 w-4 text-[var(--accent)]" />
                  )}
                </div>
              ))}
              {/* Combined badge */}
              <span
                className={cn(
                  "absolute -bottom-1 -right-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1",
                  "bg-red-500 text-[10px] font-bold text-white shadow",
                )}
              >
                {totalCount > 99 ? "99+" : totalCount}
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ── Single notification bubble ──

function NotificationBubble({
  notif,
  exiting,
  onNavigate,
  onDismiss,
}: {
  exiting: boolean;
  notif: {
    chatId: string;
    characterName: string;
    avatarUrl: string | null;
    avatarCrop?: AvatarCropValue | null;
    count: number;
  };
  onNavigate: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(exiting ? "motion-exit" : "motion-enter", "pointer-events-auto group relative")}
      style={BUBBLE_MOTION}
    >
      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className={cn(
          "absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full",
          "bg-[var(--background)] text-[var(--foreground)]/60 shadow-md ring-1 ring-[var(--foreground)]/10",
          "transition-opacity hover:text-[var(--foreground)]",
          "opacity-0 group-hover:opacity-100 max-md:opacity-100",
        )}
      >
        <X className="h-3 w-3" />
      </button>

      {/* Avatar bubble */}
      <button
        onClick={onNavigate}
        className={cn(
          "relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full",
          "bg-[var(--accent)]/20 shadow-lg ring-2 ring-[var(--accent)]/40",
          "transition-transform hover:scale-110 active:scale-95",
        )}
        title={`${notif.characterName} sent a message`}
      >
        {notif.avatarUrl ? (
          <AvatarImage src={notif.avatarUrl} alt={notif.characterName} crop={notif.avatarCrop} />
        ) : (
          <MessageCircle className="h-5 w-5 text-[var(--accent)]" />
        )}
      </button>

      {/* Red unread badge */}
      <span
        className={cn(
          "absolute -bottom-0.5 -left-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1",
          "bg-red-500 text-[10px] font-bold text-white shadow",
        )}
      >
        {notif.count > 99 ? "99+" : notif.count}
      </span>
    </div>
  );
}
