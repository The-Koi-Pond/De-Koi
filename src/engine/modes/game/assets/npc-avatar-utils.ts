import type { GameNpc } from "../../../contracts/types/game";

const DEPRECATED_BUILT_IN_MARI_AVATAR = "/sprites/mari/Mari_profile.png";

function isInvalidBuiltInMariNpcAvatar(npc: Pick<GameNpc, "name" | "avatarUrl">): boolean {
  const avatarPath = typeof npc.avatarUrl === "string" ? npc.avatarUrl.split("?")[0] : "";
  return avatarPath === DEPRECATED_BUILT_IN_MARI_AVATAR;
}

export function sanitizeGameNpcAvatarUrls(npcs: GameNpc[]): GameNpc[] {
  let changed = false;
  const sanitized = npcs.map((npc) => {
    if (!isInvalidBuiltInMariNpcAvatar(npc)) return npc;
    changed = true;
    const { avatarUrl: _avatarUrl, ...rest } = npc;
    return rest;
  });
  return changed ? sanitized : npcs;
}
