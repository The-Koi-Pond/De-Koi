import * as g from "./game-api-support";
import { worldStateApi } from "../../../runtime/world-state/index";
import { journalFromChat } from "./game-api-journal-helpers";
import { gameTimeFromMeta, weatherSeason } from "./game-api-mechanics-helpers";
import {
  resolveGameWorldTick,
  type GameWorldTickHistoryEntry,
  type GameWorldTickNpcRule,
  type GameWorldTickTrigger,
} from "../../../../engine/modes/game/world/world-tick.service";

export const WORLD_TICK_HISTORY_LIMIT = 20;

export interface GameWorldTickResponse {
  changed: boolean;
  skippedReason?: "disabled" | "duplicate";
  recap: string;
  recapLines: string[];
  time: g.GameTime;
  formatted: string;
  weather: g.WeatherState | null;
  dayChanged: boolean;
  worldTickEnabled: boolean;
  sessionChat: g.Chat;
}

function isWorldTickTrigger(value: unknown): value is GameWorldTickTrigger {
  return (
    value === "manual" ||
    value === "session_start" ||
    value === "session_end" ||
    value === "scene_end" ||
    value === "rest" ||
    value === "travel" ||
    value === "time_skip" ||
    value === "day_start"
  );
}

function isWorldTickHistoryEntry(value: unknown): value is GameWorldTickHistoryEntry {
  const record = g.asRecord(value);
  const time = g.asRecord(record.time);
  return (
    isWorldTickTrigger(record.trigger) &&
    typeof record.triggerKey === "string" &&
    record.triggerKey.trim().length > 0 &&
    typeof record.ranAt === "string" &&
    record.ranAt.trim().length > 0 &&
    typeof record.recap === "string" &&
    typeof time.day === "number" &&
    typeof time.hour === "number" &&
    typeof time.minute === "number" &&
    typeof record.dayChanged === "boolean"
  );
}

export function worldTickHistoryFromMeta(meta: Record<string, unknown>): GameWorldTickHistoryEntry[] {
  const raw = Array.isArray(meta.gameWorldTickHistory) ? meta.gameWorldTickHistory : [];
  return raw.filter(isWorldTickHistoryEntry).slice(-WORLD_TICK_HISTORY_LIMIT);
}

export function buildWorldTickTriggerKey(input: {
  chatId: string;
  trigger: GameWorldTickTrigger;
  sessionNumber: number;
  discriminator: string;
}): string {
  return `${input.trigger}:${input.chatId}:session-${input.sessionNumber}:${input.discriminator.trim()}`;
}

function weatherFromMeta(value: unknown): g.WeatherState | null {
  const record = g.asRecord(value);
  return Object.keys(record).length > 0 ? (record as unknown as g.WeatherState) : null;
}

function worldTickEnabled(meta: Record<string, unknown>, override: boolean | undefined): boolean {
  return override ?? meta.gameWorldTickEnabled === true;
}

function npcRulesFromInput(value: readonly GameWorldTickNpcRule[] | undefined): GameWorldTickNpcRule[] {
  return (value ?? [])
    .map((rule) => ({ npcId: g.readTrimmed(rule.npcId), note: g.readTrimmed(rule.note) }))
    .filter((rule) => rule.npcId && rule.note);
}

export async function runWorldTick(data: {
  chatId: string;
  trigger: GameWorldTickTrigger;
  triggerKey?: string;
  enabled?: boolean;
  discriminator?: string;
  elapsedMinutes?: number;
  npcRules?: readonly GameWorldTickNpcRule[];
}): Promise<GameWorldTickResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const sessionNumber = Number(meta.gameSessionNumber ?? 1);
  const triggerKey =
    data.triggerKey ??
    buildWorldTickTriggerKey({
      chatId: data.chatId,
      trigger: data.trigger,
      sessionNumber: Number.isFinite(sessionNumber) ? sessionNumber : 1,
      discriminator: data.discriminator ?? g.newId("tick"),
    });
  const history = worldTickHistoryFromMeta(meta);
  const currentTime = gameTimeFromMeta(meta);
  const currentWeather = weatherFromMeta(meta.gameWeather);
  const gameState = g.asRecord((chat as { gameState?: unknown }).gameState);
  const location = g.readTrimmed(gameState.location) || g.readTrimmed(meta.gameCurrentLocation) || null;
  const enabled = worldTickEnabled(meta, data.enabled);

  const result = resolveGameWorldTick({
    enabled,
    trigger: data.trigger,
    triggerKey,
    previousTriggerKeys: history.map((entry) => entry.triggerKey),
    time: currentTime,
    weather: currentWeather,
    location,
    journal: journalFromChat(chat, meta, { includeCurrentLocation: true }),
    npcs: Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as g.GameNpc[]) : [],
    npcRules: npcRulesFromInput(data.npcRules),
    elapsedMinutes: data.elapsedMinutes,
  });

  if (!result.changed) {
    return {
      changed: false,
      ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      recap: "",
      recapLines: [],
      time: result.time,
      formatted: g.formatGameTime(result.time),
      weather: currentWeather,
      dayChanged: false,
      worldTickEnabled: enabled,
      sessionChat: chat,
    };
  }

  const formatted = g.formatGameTime(result.time);
  let weather = currentWeather;
  const metadataPatch: Record<string, unknown> = {
    gameWorldTickEnabled: enabled,
    gameWorldTickLastRun: result.nextHistoryEntry,
    gameWorldTickHistory: [...history, result.nextHistoryEntry].slice(-WORLD_TICK_HISTORY_LIMIT),
    gameTime: result.time,
    gameTimeFormatted: formatted,
    gameJournal: result.journal,
    gameNpcs: result.npcs,
  };

  if (result.weatherIntent) {
    const biome = g.inferBiome(location ?? "");
    weather = g.generateWeather(biome, weatherSeason(g.asRecord(meta.gameSetupConfig).season));
    metadataPatch.gameWeather = weather;
  }

  const sessionChat = await g.patchChatMetadata(data.chatId, metadataPatch);
  await worldStateApi.patch(data.chatId, {
    time: formatted,
    ...(weather ? { weather: weather.type, temperature: `${weather.temperature}\u00b0C` } : {}),
  });

  return {
    changed: true,
    recap: result.recap,
    recapLines: result.recapLines,
    time: result.time,
    formatted,
    weather,
    dayChanged: result.dayChanged,
    worldTickEnabled: enabled,
    sessionChat,
  };
}
