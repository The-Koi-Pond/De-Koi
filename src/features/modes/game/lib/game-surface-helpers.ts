import type { Message } from "../../../../engine/contracts/types/chat";
import type { CombatEnemy, CombatPartyMember, EncounterSettings } from "../../../../engine/contracts/types/combat-encounter";
import type { Combatant } from "../../../../engine/contracts/types/game";

export type GameDirectAddressMode = "party" | "gm";

export type GameTimeMeta = {
  day?: number;
  hour?: number;
  minute?: number;
};

export type StoredNarrationProgress = {
  index: number;
  messageId: string | null;
};

export type RestoredNarrationState = {
  index: number;
  hasStoredPosition: boolean;
};

const PARTY_TURN_MESSAGE_RE = /^\[(?:party-turn|party-chat)]\s*/i;
const GAME_DIRECT_ADDRESS_RE = /^\[(?:To the party|To the GM)]\s*/i;
const GAME_SCENE_ILLUSTRATION_COOLDOWN_TURNS = 8;

export const GAME_COMBAT_GENERATION_SETTINGS = {
  combatNarrative: {
    tense: "present",
    person: "third",
    narration: "omniscient",
    pov: "narrator",
  },
  summaryNarrative: {
    tense: "past",
    person: "third",
    narration: "omniscient",
    pov: "narrator",
  },
  historyDepth: 10,
} satisfies EncounterSettings;

const GENERIC_NPC_NAME_LABELS = new Set([
  "one",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "everyone",
  "everybody",
  "no one",
  "nobody",
  "other",
  "another",
  "figure",
  "soldier",
  "guard",
  "bandit",
  "thug",
  "villager",
  "merchant",
  "clerk",
  "waiter",
  "waitress",
  "servant",
  "attendant",
  "messenger",
  "driver",
  "worker",
  "crowd",
  "voice",
  "stranger",
  "man",
  "woman",
  "boy",
  "girl",
]);

const NARRATION_NPC_REJECT_TOKENS = new Set([
  "accidentally",
  "word",
  "words",
  "line",
  "lines",
  "met",
  "not",
  "neutral",
  "acquired",
  "used",
  "lost",
  "removed",
]);

const GENERIC_COMBAT_ENEMY_PATTERNS = [
  /^(?:enemy|foe|monster|creature|beast|minion|summon|shadow|construct|automaton|drone|specter|slime)(?:\s+\d+|\s+[ivx]+)?$/i,
  /^(?:guard|soldier|bandit|thug|raider|cultist|mercenary|assassin|archer|mage|warrior)(?:\s+\d+|\s+[ivx]+)?$/i,
  /^(?:hilichurl|mitachurl|samachurl|treasure hoarder|fatui agent|ruin guard|ruin hunter|ruin sentinel)(?:\s+\d+|\s+[ivx]+)?$/i,
];

export function getGameDirectAddressMode(content: string | null | undefined): GameDirectAddressMode | null {
  const normalized = content?.trimStart().toLowerCase() ?? "";
  if (normalized.startsWith("[to the party]")) return "party";
  if (normalized.startsWith("[to the gm]")) return "gm";
  return null;
}

export function isPartyTurnMessage(message: Pick<Message, "role" | "content">): boolean {
  return (
    (message.role === "assistant" || message.role === "narrator") &&
    PARTY_TURN_MESSAGE_RE.test(message.content.trimStart())
  );
}

export function gameSceneTurnNumber(messages: Pick<Message, "role">[]): number {
  return messages.filter((message) => message.role === "assistant" || message.role === "narrator").length;
}

export function canRequestGameSceneIllustration(
  chatMeta: Record<string, unknown>,
  sessionNumber: number,
  turnNumber: number,
): boolean {
  const lastSessionNumber = Number(chatMeta.gameLastIllustrationSessionNumber ?? Number.NaN);
  const lastTurnNumber = Number(chatMeta.gameLastIllustrationTurn ?? Number.NaN);
  if (!Number.isFinite(lastSessionNumber) || !Number.isFinite(lastTurnNumber)) return true;
  if (lastSessionNumber !== sessionNumber) return true;
  return turnNumber - lastTurnNumber >= GAME_SCENE_ILLUSTRATION_COOLDOWN_TURNS;
}

export function stripPartyTurnMarker(content: string): string {
  return content.trimStart().replace(PARTY_TURN_MESSAGE_RE, "").trim();
}

export function stripGameDirectAddressPrefix(content: string): string {
  return content.trimStart().replace(GAME_DIRECT_ADDRESS_RE, "").trim();
}

export function normalizeGameDay(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(9999, Math.floor(parsed)));
}

export function normalizeGameHour(value: unknown, fallback = 8): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(23, Math.floor(parsed)));
}

export function normalizeGameMinute(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(59, Math.floor(parsed)));
}

function getGameTimeOfDayLabel(hour: number): string {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening";
  if (hour >= 20) return "night";
  return "midnight";
}

export function formatGameTimeForHud(time: Required<GameTimeMeta>): string {
  const h = String(time.hour).padStart(2, "0");
  const m = String(time.minute).padStart(2, "0");
  return `Day ${time.day}, ${h}:${m} (${getGameTimeOfDayLabel(time.hour)})`;
}

export function parseGameDayFromTimeLabel(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\bday\s+(\d{1,4})\b/i);
  if (!match) return null;
  return normalizeGameDay(match[1]);
}

export function parseHourMinuteFromTimeLabel(value?: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = value.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!match) return null;
  return {
    hour: normalizeGameHour(match[1]),
    minute: normalizeGameMinute(match[2]),
  };
}

export function parseStoredNarrationProgress(raw: string | null): StoredNarrationProgress | null {
  if (!raw) return null;

  const legacyIndex = Number(raw.trim());
  const legacyProgress =
    Number.isFinite(legacyIndex) && legacyIndex >= 0
      ? {
          index: legacyIndex,
          messageId: null,
        }
      : null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "number") return legacyProgress;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as {
      index?: unknown;
      messageId?: unknown;
    };
    if (typeof record.index === "number" && Number.isFinite(record.index) && record.index >= 0) {
      return {
        index: record.index,
        messageId: typeof record.messageId === "string" ? record.messageId : null,
      };
    }
  } catch {
    return legacyProgress;
  }

  return null;
}

export function resolveRestoredNarrationState(options: {
  currentMessageId: string | null;
  storedProgress: StoredNarrationProgress | null;
  serverIndex: unknown;
  serverMessageId: unknown;
}): RestoredNarrationState {
  const { currentMessageId, storedProgress, serverIndex, serverMessageId } = options;
  if (!currentMessageId) return { index: 0, hasStoredPosition: false };

  if (storedProgress?.messageId && storedProgress.messageId === currentMessageId) {
    return { index: storedProgress.index, hasStoredPosition: true };
  }

  const normalizedServerMessageId = typeof serverMessageId === "string" ? serverMessageId : null;
  if (
    normalizedServerMessageId === currentMessageId &&
    typeof serverIndex === "number" &&
    Number.isFinite(serverIndex) &&
    serverIndex >= 0
  ) {
    return { index: serverIndex, hasStoredPosition: true };
  }

  if (storedProgress && storedProgress.messageId === null) {
    return { index: storedProgress.index, hasStoredPosition: true };
  }

  return { index: 0, hasStoredPosition: false };
}

export function normalizeSceneAssetName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function isLikelyNarrationNpcName(rawName: string): boolean {
  const name = rawName.trim();
  if (!name || name.length > 48) return false;
  if (!/^\p{Lu}/u.test(name)) return false;
  if (/[<>{}"“”]/u.test(name) || name.includes("[") || name.includes("]")) return false;

  const normalized = normalizeSceneAssetName(name);
  if (!normalized || GENERIC_NPC_NAME_LABELS.has(normalized)) return false;

  const tokens = normalized.split(/\s+/);
  if (tokens.some((token) => NARRATION_NPC_REJECT_TOKENS.has(token))) return false;
  return true;
}

export function isLikelyNamedCombatEnemy(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const normalized = normalizeSceneAssetName(trimmed)
    .replace(/\b(?:\d+|[ivx]+)\b/gi, "")
    .trim();
  if (!normalized || GENERIC_NPC_NAME_LABELS.has(normalized)) return false;
  return !GENERIC_COMBAT_ENEMY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function slugifyCombatantId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "unknown"
  );
}

export function combatLevelFromHp(maxHp: number, fallbackLevel: number): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return fallbackLevel;
  return Math.max(1, Math.round(maxHp / 20));
}

export function combatStatusEffectsFromGenerated(
  statuses: CombatPartyMember["statuses"] | CombatEnemy["statuses"] | undefined,
): Combatant["statusEffects"] {
  if (!Array.isArray(statuses)) return undefined;
  const mapped = statuses
    .filter((status) => status?.name)
    .map((status) => ({
      name: typeof status.name === "string" ? status.name : String(status.name),
      modifier: typeof status.modifier === "number" ? status.modifier : 0,
      stat: status.stat ?? ("hp" as const),
      turnsLeft: Math.max(1, Number(status.duration) || 1),
    }));
  return mapped.length > 0 ? mapped : undefined;
}

export function combatSkillsFromGeneratedAttacks(
  attacks: CombatPartyMember["attacks"] | CombatEnemy["attacks"] | undefined,
  level: number,
): Combatant["skills"] {
  if (!Array.isArray(attacks)) return undefined;
  const seen = new Set<string>();
  const skills: NonNullable<Combatant["skills"]> = [];
  for (const [index, attack] of attacks.entries()) {
    const name = typeof attack?.name === "string" ? attack.name.trim() : "";
    if (!name || /^(attack|basic attack|strike)$/i.test(name)) continue;
    const id = slugifyCombatantId(`${name}-${index}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skills.push({
      id,
      name,
      type: "attack",
      mpCost: Math.max(4, Math.min(18, 5 + level)),
      power:
        typeof attack.power === "number" && Number.isFinite(attack.power)
          ? Math.max(0.5, Math.min(3, attack.power))
          : attack.type === "AoE"
            ? 1.15
            : 1.35,
      description: attack.description || (attack.type === "AoE" ? "Area combat ability" : "Combat ability"),
      cooldown: typeof attack.cooldown === "number" ? attack.cooldown : undefined,
      element: typeof attack.element === "string" ? attack.element : undefined,
      statusEffect: typeof attack.statusEffect === "string" ? attack.statusEffect : undefined,
    });
  }
  return skills.length > 0 ? skills : undefined;
}
