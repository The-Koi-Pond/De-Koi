import * as g from "./game-api-support";

const WEATHER_SEASONS = new Set<g.Season>(["spring", "summer", "autumn", "winter"]);

function isWeatherSeason(value: unknown): boolean {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return WEATHER_SEASONS.has(normalized as g.Season);
}

export function weatherSeason(value: unknown): g.Season {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isWeatherSeason(normalized) ? (normalized as g.Season) : "summer";
}

export function gameTimeFromMeta(meta: Record<string, unknown>): g.GameTime {
  const raw = g.asRecord(meta.gameTime);
  const day = Number(raw.day ?? 1);
  const hour = Number(raw.hour ?? 8);
  const minute = Number(raw.minute ?? 0);
  return {
    day: Number.isFinite(day) && day >= 1 ? day : 1,
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 8,
    minute: Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.floor(minute))) : 0,
  };
}

export function moraleFromMeta(meta: Record<string, unknown>): number {
  const raw = meta.gameMorale;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
}

function syncMoraleWidgets(rawWidgets: unknown, morale: number): unknown {
  if (!Array.isArray(rawWidgets)) return rawWidgets;
  return rawWidgets.map((widget) => {
    const record = g.asRecord(widget);
    const label = `${record.title ?? record.label ?? record.id ?? record.type ?? ""}`.toLowerCase();
    if (!label.includes("morale")) return widget;
    const config = g.asRecord(record.config);
    return {
      ...record,
      value: morale,
      config: {
        ...config,
        value: morale,
      },
    };
  });
}

export function moraleMetadataPatch(meta: Record<string, unknown>, morale: number): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    gameMorale: morale,
    gameMoraleTier: g.getMoraleTier(morale),
  };
  const widgetState = syncMoraleWidgets(meta.gameWidgetState, morale);
  if (widgetState !== meta.gameWidgetState) patch.gameWidgetState = widgetState;
  const blueprint = g.asRecord(meta.gameBlueprint);
  const hudWidgets = syncMoraleWidgets(blueprint.hudWidgets, morale);
  if (hudWidgets !== blueprint.hudWidgets) {
    patch.gameBlueprint = {
      ...blueprint,
      hudWidgets,
    };
  }
  return patch;
}

export function playerAttributes(meta: Record<string, unknown>): Partial<g.RPGAttributes> {
  const cards = Array.isArray(meta.gameCharacterCards) ? meta.gameCharacterCards : [];
  const first = g.asRecord(cards[0]);
  const rpgStats = g.asRecord(first.rpgStats);
  return g.mapSheetAttributesToRPG(g.sheetAttributes(rpgStats.attributes));
}

function weatherFromMeta(value: unknown): g.WeatherState | null {
  const weather = g.asRecord(value);
  return Object.keys(weather).length > 0 ? (weather as unknown as g.WeatherState) : null;
}

export function resolveWeatherUpdate(
  existing: unknown,
  forced: g.WeatherState,
  rolledChange: boolean,
): { changed: boolean; weather: g.WeatherState; shouldPersist: boolean } {
  const existingWeather = weatherFromMeta(existing);
  if (rolledChange || !existingWeather) {
    return { changed: true, weather: forced, shouldPersist: true };
  }
  return { changed: false, weather: existingWeather, shouldPersist: false };
}

function replaceFirstUnresolvedSkillCheckTag(content: string, resolvedTag: string): string {
  let replaced = false;
  return content.replace(/\[skill_check:\s*([^\]]+)\]/gi, (fullTag, body: string) => {
    if (replaced) return fullTag;
    if (/\bresult\s*=/i.test(body)) return fullTag;
    replaced = true;
    return resolvedTag;
  });
}

const SKILL_CHECK_HISTORY_PERSIST_ATTEMPTS = 3;

export async function persistResolvedSkillCheckTag(
  chatId: string,
  messageId: string | undefined,
  result: g.SkillCheckResult,
): Promise<string | undefined> {
  const id = typeof messageId === "string" ? messageId.trim() : "";
  if (!id) return undefined;
  try {
    const conditionalUpdate = g.storageApi.updateChatMessageContentIfUnchanged;
    if (typeof conditionalUpdate !== "function") {
      throw new Error("Conditional chat message content update is unavailable");
    }
    const resolvedTag = g.serializeResolvedSkillCheckTag(result);
    for (let attempt = 0; attempt < SKILL_CHECK_HISTORY_PERSIST_ATTEMPTS; attempt += 1) {
      const message = await g.storageApi.get<g.ChatMessage>("messages", id);
      if (typeof message?.chatId !== "string" || message.chatId !== chatId) return undefined;
      const content = typeof message?.content === "string" ? message.content : "";
      if (!content) return undefined;
      const updatedContent = replaceFirstUnresolvedSkillCheckTag(content, resolvedTag);
      if (updatedContent === content) return undefined;
      const update = await conditionalUpdate<g.ChatMessage>(chatId, id, content, updatedContent);
      if (update.updated) {
        return typeof update.message?.content === "string" ? update.message.content : updatedContent;
      }
    }
    return undefined;
  } catch (error) {
    console.warn("[game] skill check history persist failed", error);
    return undefined;
  }
}
