import type { ChatMode } from "../../../engine/contracts/types/chat";

export const MODE_ROUTE_LOADERS = {
  conversation: async () => {
    const module = await import("../conversation/index");
    return { default: module.ConversationModeRoute };
  },
  roleplay: async () => {
    const module = await import("../roleplay/index");
    return { default: module.RoleplayModeRoute };
  },
  fanfic: async () => {
    const module = await import("../fanfic/index");
    return { default: module.FanficModeRoute };
  },
} as const;

export type ModeRoutePreloaders = Record<ChatMode, () => Promise<unknown>>;

export async function preloadModeRoute(
  mode: ChatMode,
  loaders: ModeRoutePreloaders = MODE_ROUTE_LOADERS,
): Promise<void> {
  await loaders[mode]();
}
