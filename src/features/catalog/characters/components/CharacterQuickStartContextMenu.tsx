import { Feather, MessageCircle, Wand2 } from "lucide-react";

import { ModeIcon } from "../../../../shared/components/ModeIcon";
import { ContextMenu, type ContextMenuItem } from "../../../../shared/components/ui/ContextMenu";

export type CharacterQuickStartContextMenuState = {
  x: number;
  y: number;
  charId: string;
  charName: string;
  firstMes?: string;
  altGreetings?: string[];
};

/**
 * Pick which kind of chat to start with a character: opened by right-clicking a row or its start-chat button.
 * The Pond theme shows its own mode icons (drawn for 18px and up); other themes keep these small ones.
 */
export function CharacterQuickStartContextMenu({
  menu,
  pendingStartCharacterId,
  onClose,
  onStartRoleplay,
  onStartConversation,
  onStartFanfic,
}: {
  menu: CharacterQuickStartContextMenuState;
  pendingStartCharacterId: string | null;
  onClose: () => void;
  onStartRoleplay: (menu: CharacterQuickStartContextMenuState) => void;
  onStartConversation: (menu: CharacterQuickStartContextMenuState) => void;
  onStartFanfic: (menu: CharacterQuickStartContextMenuState) => void;
}) {
  const items: ContextMenuItem[] = [
    {
      label: "Quick Start Conversation",
      icon: <ModeIcon mode="conversation" className="block" fallback={<MessageCircle size="0.75rem" />} />,
      onSelect: () => onStartConversation(menu),
    },
    {
      label: "Quick Start Roleplay",
      icon: <ModeIcon mode="roleplay" className="block" fallback={<Wand2 size="0.75rem" />} />,
      disabled: pendingStartCharacterId === menu.charId,
      onSelect: () => onStartRoleplay(menu),
    },
    {
      label: "Quick Start Fanfic",
      icon: <ModeIcon mode="fanfic" className="block" fallback={<Feather size="0.75rem" />} />,
      onSelect: () => onStartFanfic(menu),
    },
  ];

  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />;
}
