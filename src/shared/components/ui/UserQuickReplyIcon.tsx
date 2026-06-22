import type { QuickReplyIconId } from "../../stores/ui.store";
import { Bookmark, Dices, FileText, MessageCircle, ScrollText, UserCheck, WandSparkles, Zap } from "lucide-react";

interface UserQuickReplyIconProps {
  iconId: QuickReplyIconId;
  size?: string | number;
  className?: string;
}

export function UserQuickReplyIcon({ iconId, size = "0.875rem", className }: UserQuickReplyIconProps) {
  const props = { size, className, "aria-hidden": true } as const;
  switch (iconId) {
    case "file-text":
      return <FileText {...props} />;
    case "user-check":
      return <UserCheck {...props} />;
    case "message-circle":
      return <MessageCircle {...props} />;
    case "scroll-text":
      return <ScrollText {...props} />;
    case "bookmark":
      return <Bookmark {...props} />;
    case "zap":
      return <Zap {...props} />;
    case "dices":
      return <Dices {...props} />;
    case "wand":
    default:
      return <WandSparkles {...props} />;
  }
}
