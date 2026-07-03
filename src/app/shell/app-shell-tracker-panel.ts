import type { ChatMode } from "../../engine/contracts/types/chat";

export function isTrackerPanelAvailableForChatMode(mode: ChatMode | null | undefined) {
  return mode === "roleplay" || mode === "game";
}
