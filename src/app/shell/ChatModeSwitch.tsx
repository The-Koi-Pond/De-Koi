import { useId, type ReactNode } from "react";
import { BookOpen, Feather, MessageSquare, Orbit } from "lucide-react";

import { CHAT_MODES } from "../../engine/contracts/constants/chat-modes";
import { ModeIcon } from "../../shared/components/ModeIcon";

export const CHAT_SIDEBAR_TABS = ["conversation", "roleplay", "fanfic", "trance"] as const;
export type ChatSidebarTab = (typeof CHAT_SIDEBAR_TABS)[number];

/** Each mode's icon outside the Pond theme (Pond draws its own, see ModeIcon). */
export const CHAT_MODE_LUCIDE_ICONS: Record<ChatSidebarTab, (size: string) => ReactNode> = {
  conversation: (size) => <MessageSquare size={size} aria-hidden="true" />,
  roleplay: (size) => <BookOpen size={size} aria-hidden="true" />,
  fanfic: (size) => <Feather size={size} aria-hidden="true" />,
  trance: (size) => <Orbit size={size} aria-hidden="true" />,
};

/** Names for a narrow switch (a phone's chat drawer), where a quarter of the column can't fit the full one. */
const SHORT_TAB_NAMES: Partial<Record<ChatSidebarTab, string>> = { conversation: "Chat" };

/**
 * Conversation | Roleplay | Fanfic | Trance in the chat list's title bar: the Characters | Personas switch's
 * inset track with four cells, icon over name, the chosen one glowing in its mode's colour
 * (`.de-koi-mode-switch` in 04-surfaces-components.css). Arrow keys move between the modes.
 * `onSelect` resolves false when the switch was called off (unsaved work the user kept).
 */
export function ChatModeSwitch({
  activeTab,
  unreadByTab,
  onSelect,
}: {
  activeTab: ChatSidebarTab;
  unreadByTab: Record<ChatSidebarTab, number>;
  onSelect: (tab: ChatSidebarTab) => Promise<boolean>;
}) {
  const idPrefix = useId();
  const tabId = (tab: ChatSidebarTab) => `${idPrefix}-chat-mode-${tab}`;

  const selectFromKeyboard = (tab: ChatSidebarTab) => {
    void onSelect(tab).then((switched) => {
      if (switched) document.getElementById(tabId(tab))?.focus();
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Chat modes"
      className="de-koi-people-switch de-koi-mode-switch @container min-w-0 flex-1"
      onKeyDown={(event) => {
        const index = CHAT_SIDEBAR_TABS.indexOf(activeTab);
        const last = CHAT_SIDEBAR_TABS.length - 1;
        const nextIndex =
          event.key === "ArrowRight"
            ? (index + 1) % CHAT_SIDEBAR_TABS.length
            : event.key === "ArrowLeft"
              ? (index + last) % CHAT_SIDEBAR_TABS.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? last
                  : null;
        if (nextIndex === null) return;
        event.preventDefault();
        selectFromKeyboard(CHAT_SIDEBAR_TABS[nextIndex]!);
      }}
    >
      {CHAT_SIDEBAR_TABS.map((tab) => {
        const selected = tab === activeTab;
        const unread = unreadByTab[tab];
        return (
          <button
            key={tab}
            id={tabId(tab)}
            type="button"
            role="tab"
            data-mode={tab}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => void onSelect(tab)}
            className="de-koi-people-switch-tab"
          >
            <ModeIcon mode={tab} fallback={CHAT_MODE_LUCIDE_ICONS[tab]("0.8125rem")} className="shrink-0" />
            {SHORT_TAB_NAMES[tab] ? (
              <>
                <span className="max-w-full truncate @max-[16.5rem]:hidden">{CHAT_MODES[tab].name}</span>
                <span className="hidden max-w-full truncate @max-[16.5rem]:inline">{SHORT_TAB_NAMES[tab]}</span>
              </>
            ) : (
              <span className="max-w-full truncate">{CHAT_MODES[tab].name}</span>
            )}
            {unread > 0 && !selected && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[0.5625rem] font-bold leading-none text-white"
                >
                  {unread > 99 ? "99+" : unread}
                </span>
                <span className="sr-only">, {unread} unread</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
