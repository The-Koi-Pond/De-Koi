import type { GameNpc } from "../../../contracts/types/game";

const DEPRECATED_BUILT_IN_ASSISTANT_AVATAR = "/sprites/mari/Mari_profile.png";

function isInvalidBuiltInAssistantNpcAvatar(npc: Pick<GameNpc, "name" | "avatarUrl">): boolean {
  const avatarPath = typeof npc.avatarUrl === "string" ? npc.avatarUrl.split("?")[0] : "";
  return avatarPath === DEPRECATED_BUILT_IN_ASSISTANT_AVATAR;
}

export function sanitizeGameNpcAvatarUrls(npcs: GameNpc[]): GameNpc[] {
  let changed = false;
  const sanitized = npcs.map((npc) => {
    if (!isInvalidBuiltInAssistantNpcAvatar(npc)) return npc;
    changed = true;
    const { avatarUrl: _avatarUrl, ...rest } = npc;
    return rest;
  });
  return changed ? sanitized : npcs;
}
