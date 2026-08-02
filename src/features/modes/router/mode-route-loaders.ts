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
  game: async () => {
    const module = await import("../game/index");
    return { default: module.GameModeRoute };
  },
} as const;

export type ModeRoutePreloaders = Record<ChatMode, () => Promise<unknown>>;

export async function preloadModeRoute(
  mode: ChatMode,
  loaders: ModeRoutePreloaders = MODE_ROUTE_LOADERS,
): Promise<void> {
  await loaders[mode]();
}
