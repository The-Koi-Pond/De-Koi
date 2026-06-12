import * as g from "./game-api-support";
import { createAutomaticGameCheckpoint } from "./game-api-checkpoint-helpers";
import {
  gameTimeFromMeta,
  moraleFromMeta,
  moraleMetadataPatch,
  persistResolvedSkillCheckTag,
  playerAttributes,
  resolveWeatherUpdate,
  weatherSeason,
} from "./game-api-mechanics-helpers";

const DEFAULT_COMBAT_ENCOUNTER_SETTINGS: g.EncounterSettings = {
  combatNarrative: {
    tense: "present",
    person: "second",
    narration: "limited",
    pov: "player",
  },
  summaryNarrative: {
    tense: "past",
    person: "third",
    narration: "omniscient",
    pov: "party",
  },
  historyDepth: 10,
};

export async function rollDice(data: { notation: string }) {
  return { result: g.rollGameDice(data.notation) };
}

export async function skillCheck(data: {
  chatId: string;
  skill: string;
  dc: number;
  advantage?: boolean;
  disadvantage?: boolean;
  preRolledD20?: number;
  skillModifier?: number;
  messageId?: string;
}) {
  const meta = g.chatMeta(await g.getChat(data.chatId));
  const attrs = playerAttributes(meta);
  const attr = g.getGoverningAttribute(data.skill);
  const attrScore = Number(attrs[attr] ?? 10);
  const result = g.resolveSkillCheck({
    skill: data.skill,
    dc: data.dc,
    skillModifier: Number(data.skillModifier ?? 0),
    attributeModifier: Math.floor((attrScore - 10) / 2),
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    preRolledD20: data.preRolledD20,
  });
  return {
    result,
    updatedContent: await persistResolvedSkillCheckTag(data.chatId, data.messageId, result),
  };
}

export async function transitionGameState(data: { chatId: string; newState: g.GameActiveState }) {
  const meta = g.chatMeta(await g.getChat(data.chatId));
  const previousState = (meta.gameActiveState as g.GameActiveState | undefined) ?? "exploration";
  const newState = g.validateTransition(previousState, data.newState);
  const checkpoint =
    previousState !== newState && newState === "combat"
      ? ({ timing: "before", label: "Combat started", triggerType: "combat_start" } as const)
      : previousState !== newState && previousState === "combat"
        ? ({ timing: "after", label: "Combat ended", triggerType: "combat_end" } as const)
        : null;
  let checkpointWarning: g.GameCheckpointWarning | null = null;
  if (checkpoint?.timing === "before") {
    checkpointWarning = await createAutomaticGameCheckpoint({
      chatId: data.chatId,
      label: checkpoint.label,
      triggerType: checkpoint.triggerType,
    });
  }
  const sessionChat = await g.patchChatMetadata(data.chatId, { gameActiveState: newState });
  if (checkpoint?.timing === "after") {
    checkpointWarning = await createAutomaticGameCheckpoint({
      chatId: data.chatId,
      label: checkpoint.label,
      triggerType: checkpoint.triggerType,
    });
  }
  return { previousState, newState, sessionChat, ...(checkpointWarning ? { checkpointWarning } : {}) };
}

export async function updateWidgets(data: { chatId: string; widgets: g.HudWidget[] }) {
  const sessionChat = await g.patchChatMetadata(data.chatId, { gameWidgetState: data.widgets });
  return { ok: true, sessionChat };
}

export async function combatRound(data: {
  combatants: Array<Omit<g.Combatant, "sprite">>;
  round: number;
  playerAction?: g.CombatPlayerAction;
  mechanics?: g.CombatMechanic[];
  elementPreset?: string;
}) {
  const combatants: Array<Omit<g.Combatant, "sprite">> = data.combatants.map((combatant) => ({ ...combatant }));
  const result = g.resolveCombatRound(
    combatants,
    data.round,
    "normal",
    data.elementPreset,
    data.playerAction,
    data.mechanics,
  );
  return { result, combatants: combatants as g.Combatant[] };
}

export async function applyMoraleEvent(data: { chatId: string; event: g.MoraleEvent; modifier?: number }) {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const morale = g.applyMoraleEvent(moraleFromMeta(meta), data.event, data.modifier);
  const sessionChat = await g.patchChatMetadata(data.chatId, moraleMetadataPatch(meta, morale.value));
  return { morale, sessionChat };
}

export async function elementPresets() {
  return {
    presets: g.listElementPresets().map((id) => {
      const preset = g.getElementPreset(id);
      return {
        id,
        name: preset.name,
        elementCount: preset.elements.length,
        reactionCount: preset.reactions.length,
      };
    }),
  };
}

export async function elementPreset(name: string) {
  const preset = g.getElementPreset(name);
  return {
    name: preset.name,
    elements: preset.elements,
    reactions: preset.reactions,
  };
}

export async function combatLoot(data: { enemyCount: number; difficulty?: string }) {
  return { drops: g.generateCombatLoot(data.enemyCount, data.difficulty ?? "normal") };
}

export async function lootGenerate(data: { count?: number; difficulty?: string }): Promise<{ drops: g.LootDrop[] }> {
  return { drops: g.generateLootTable(Math.max(0, Math.min(10, data.count ?? 1)), data.difficulty ?? "normal") };
}

export async function advanceTime(data: {
  chatId: string;
  action: string;
}): Promise<{ time: g.GameTime; formatted: string; sessionChat: g.Chat }> {
  const meta = g.chatMeta(await g.getChat(data.chatId));
  const currentTime = gameTimeFromMeta(meta);
  const time = g.isTimeOfDayLabel(data.action)
    ? g.setTimeOfDay(currentTime, data.action)
    : g.advanceGameTime(currentTime, data.action);
  const formatted = g.formatGameTime(time);
  const sessionChat = await g.patchChatMetadata(data.chatId, { gameTime: time, gameTimeFormatted: formatted });
  return { time, formatted, sessionChat };
}

export async function updateWeather(data: {
  chatId: string;
  action: string;
  location?: string;
  season?: string;
  type?: string;
}): Promise<{ changed: boolean; weather: g.WeatherState; sessionChat: g.Chat }> {
  const chat = await g.getChat(data.chatId);
  const biome = g.inferBiome(data.location ?? "");
  const season = weatherSeason(data.season);
  if (data.season && season === "summer" && data.season !== "summer") {
    console.warn("[game] Invalid weather season; defaulting to summer", {
      season: data.season,
      biome,
      location: data.location ?? "",
    });
  }
  let forced = g.generateWeather(biome, season);
  if (data.type) {
    forced = {
      ...forced,
      type: data.type as g.WeatherState["type"],
      description: `The weather is ${data.type}.`,
    };
  }
  const rolledChange =
    Boolean(data.type) ||
    Math.random() <
      (data.action === "travel" ? 0.35 : data.action === "rest_long" ? 0.6 : data.action === "explore" ? 0.2 : 0.08);
  const weatherUpdate = resolveWeatherUpdate(g.chatMeta(chat).gameWeather, forced, rolledChange);
  const sessionChat = weatherUpdate.shouldPersist
    ? await g.patchChatMetadata(data.chatId, { gameWeather: forced })
    : chat;
  return { changed: weatherUpdate.changed, weather: weatherUpdate.weather, sessionChat };
}

export async function rollEncounter(data: {
  action: string;
  location?: string;
  difficulty?: string;
  partySize?: number;
}) {
  const encounter = g.rollGameEncounter(data.action, data.difficulty ?? "normal", data.location ?? "");
  const enemyCount =
    encounter.type === "combat" ? g.rollEnemyCount(data.partySize ?? 1, data.difficulty ?? "normal") : 0;
  return { encounter, enemyCount };
}

export async function updateReputation(data: {
  chatId: string;
  actions: Array<{ npcId: string; action: string; modifier?: number }>;
}) {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as g.GameNpc[]) : [];
  const result = g.processReputationActions(npcs, data.actions);
  const sessionChat = await g.patchChatMetadata(data.chatId, { gameNpcs: result.npcs });
  return { npcs: result.npcs, changes: result.changes, sessionChat };
}

export async function initCombatEncounter(input: {
  chatId: string;
  connectionId?: string | null;
  settings?: g.EncounterSettings | null;
  spellbookId?: string | null;
  debugMode?: boolean;
  debugSink?: (entry: Omit<g.AgentDebugEntry, "timestamp"> & { timestamp?: number }) => void;
}): Promise<{ combatState: g.CombatInitState }> {
  return g.initGameCombatEncounter(
    { storage: g.storageApi, llm: g.llmApi },
    {
      chatId: input.chatId,
      connectionId: input.connectionId ?? null,
      settings: input.settings ?? DEFAULT_COMBAT_ENCOUNTER_SETTINGS,
      spellbookId: input.spellbookId ?? null,
      debugMode: input.debugMode === true,
      debugSink: input.debugSink,
    },
  );
}
