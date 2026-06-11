import * as g from "./game-api-support";
import {
  defaultGameMap,
  gameMapJsonRepairContext,
  mapForMovement,
  mapJsonCouldNotApplyError,
  moveMapPartyPosition,
  normalizeGeneratedMap,
} from "./game-api-map-helpers";

export async function generateMap(data: {
  chatId: string;
  locationType: string;
  context: string;
  connectionId?: string | null;
  generated?: Record<string, unknown>;
}): Promise<g.MapResponse> {
  const fallbackMap = defaultGameMap(data.locationType || "Area", data.context || "");
  let map = fallbackMap;
  if (data.generated || data.connectionId) {
    const generated =
      data.generated ??
      (await g.llmJson({
        connectionId: data.connectionId,
        fallback: fallbackMap as unknown as Record<string, unknown>,
        system: "You generate compact RPG map JSON for De-Koi Game mode.",
        user: g.buildMapGenerationPrompt(data.locationType || "Area", data.context || ""),
        repair: gameMapJsonRepairContext(data),
      }));
    const normalizedMap = normalizeGeneratedMap(generated, fallbackMap);
    if (!normalizedMap) {
      if (data.generated) throw new Error("The repaired map JSON object could not be applied.");
      throw mapJsonCouldNotApplyError(generated, data);
    }
    map = normalizedMap;
  }
  const chat = await g.getChat(data.chatId);
  const meta = g.withActiveGameMapMeta(g.chatMeta(chat), map);
  const sessionChat = await g.patchChatMetadata(data.chatId, meta);
  const savedMap = (meta.gameMap as g.GameMap | undefined) ?? map;
  const savedMaps = Array.isArray(meta.gameMaps) ? (meta.gameMaps as g.GameMap[]) : [savedMap];
  const activeGameMapId = typeof meta.activeGameMapId === "string" ? meta.activeGameMapId : (savedMap.id ?? null);
  return { map: savedMap, maps: savedMaps, activeGameMapId, sessionChat };
}

export async function moveOnMap(data: {
  chatId: string;
  position: { x: number; y: number } | string;
  mapId?: string | null;
}): Promise<g.MapResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const current = mapForMovement(meta, data.mapId);
  const map = moveMapPartyPosition(current, data.position);
  const nextMeta = g.withActiveGameMapMeta(meta, map);
  const sessionChat = await g.patchChatMetadata(data.chatId, nextMeta);
  return {
    map,
    maps: Array.isArray(nextMeta.gameMaps) ? (nextMeta.gameMaps as g.GameMap[]) : [map],
    activeGameMapId: typeof nextMeta.activeGameMapId === "string" ? nextMeta.activeGameMapId : (map.id ?? null),
    sessionChat,
  };
}
