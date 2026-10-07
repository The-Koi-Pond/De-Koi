import * as g from "./game-api-support";
import { worldStateApi } from "../../../runtime/world-state/index";

const BASELINE_META_FIELDS = [
  "gameTime",
  "gameTimeFormatted",
  "gameWeather",
  "gameWorldTickHistory",
  "gameWorldTickLastRun",
] as const;

type BaselineMetaField = (typeof BASELINE_META_FIELDS)[number];
type BaselineVisibleField = "time" | "weather" | "temperature";

/**
 * The clock, weather and world-tick state as it stood before a GM reply moved it.
 * Retry Turn restores it so a discarded reply's time skip, weather change and
 * scene-end world tick don't stack under the regenerated reply's own.
 */
export interface GameClockBaseline {
  messageId: string;
  metadata: Record<BaselineMetaField, unknown>;
  /** The time/weather/temperature shown in the HUD (the chat's world state). */
  visible: Record<BaselineVisibleField, string | null>;
  /** NPC notes the reply's scene-end world tick added; the rewind removes exactly these. */
  tickNpcNotes: TickNpcNote[];
}

export interface TickNpcNote {
  npcId: string;
  note: string;
}

function readTickNpcNotes(value: unknown): TickNpcNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = g.asRecord(entry);
    return typeof record.npcId === "string" && typeof record.note === "string"
      ? [{ npcId: record.npcId, note: record.note }]
      : [];
  });
}

function pick<K extends string>(source: Record<string, unknown>, fields: readonly K[]): Record<K, unknown> {
  return Object.fromEntries(fields.map((field) => [field, source[field] ?? null])) as Record<K, unknown>;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function readClockBaseline(value: unknown): GameClockBaseline | null {
  const record = g.asRecord(value);
  const messageId = g.readTrimmed(record.messageId);
  if (!messageId) return null;
  const visible = g.asRecord(record.visible);
  return {
    messageId,
    metadata: pick(g.asRecord(record.metadata), BASELINE_META_FIELDS),
    visible: {
      time: textOrNull(visible.time),
      weather: textOrNull(visible.weather),
      temperature: textOrNull(visible.temperature),
    },
    tickNpcNotes: readTickNpcNotes(record.tickNpcNotes),
  };
}

/**
 * Metadata to write alongside the first clock change a GM reply makes. Later changes from the
 * same reply (and from its regenerations) keep the first snapshot, so it stays the pre-turn state.
 */
export function clockBaselinePatch(
  chat: g.Chat,
  turnMessageId: string | undefined,
): { gameClockBaseline?: GameClockBaseline } {
  const messageId = g.readTrimmed(turnMessageId);
  if (!messageId) return {};
  const meta = g.chatMeta(chat);
  if (readClockBaseline(meta.gameClockBaseline)?.messageId === messageId) return {};
  const visible = g.asRecord((chat as { gameState?: unknown }).gameState);
  return {
    gameClockBaseline: {
      messageId,
      metadata: pick(meta, BASELINE_META_FIELDS),
      visible: {
        time: textOrNull(visible.time),
        weather: textOrNull(visible.weather),
        temperature: textOrNull(visible.temperature),
      },
      tickNpcNotes: [],
    },
  };
}

/** NPC notes present in `after` but not in `before`, matched by NPC id. */
export function addedNpcNotes(before: readonly g.GameNpc[], after: readonly g.GameNpc[]): TickNpcNote[] {
  const previous = new Map(before.map((npc) => [npc.id, npc.notes ?? []]));
  return after.flatMap((npc) => {
    const earlier = previous.get(npc.id);
    if (!earlier) return [];
    const remaining = [...earlier];
    return (npc.notes ?? []).flatMap((note) => {
      const index = remaining.indexOf(note);
      if (index >= 0) {
        remaining.splice(index, 1);
        return [];
      }
      return [{ npcId: npc.id, note }];
    });
  });
}

/**
 * Baseline patch for a reply's scene-end world tick: the usual pre-turn snapshot, plus the NPC
 * notes this tick added, so Retry Turn can take back exactly those and nothing else about the NPCs.
 */
export function worldTickBaselinePatch(
  chat: g.Chat,
  turnMessageId: string | undefined,
  addedNotes: readonly TickNpcNote[],
): { gameClockBaseline?: GameClockBaseline } {
  const fresh = clockBaselinePatch(chat, turnMessageId).gameClockBaseline;
  if (addedNotes.length === 0) return fresh ? { gameClockBaseline: fresh } : {};
  const baseline = fresh ?? readClockBaseline(g.chatMeta(chat).gameClockBaseline);
  if (!baseline || baseline.messageId !== g.readTrimmed(turnMessageId)) return {};
  return { gameClockBaseline: { ...baseline, tickNpcNotes: [...baseline.tickNpcNotes, ...addedNotes] } };
}

function withoutTickNpcNotes(npcs: unknown, notes: readonly TickNpcNote[]): unknown {
  if (!Array.isArray(npcs) || notes.length === 0) return npcs;
  return npcs.map((npc) => {
    const record = g.asRecord(npc);
    const owned = notes.filter((entry) => entry.npcId === record.id).map((entry) => entry.note);
    if (owned.length === 0 || !Array.isArray(record.notes)) return npc;
    const next = [...(record.notes as unknown[])];
    for (const note of owned) {
      const index = next.lastIndexOf(note);
      if (index >= 0) next.splice(index, 1);
    }
    return { ...record, notes: next };
  });
}

export interface RestoreClockBaselineResult {
  restored: boolean;
  visible: GameClockBaseline["visible"] | null;
  sessionChat: g.Chat;
}

export const WORLD_TICK_JOURNAL_TITLE_PREFIX = "World advanced:";

function isWorldTickEntryFor(entry: unknown, messageId: string): boolean {
  const record = g.asRecord(entry);
  return (
    record.type === "event" &&
    record.sourceMessageId === messageId &&
    typeof record.title === "string" &&
    record.title.startsWith(WORLD_TICK_JOURNAL_TITLE_PREFIX)
  );
}

/** Mark the journal entries a scene-end world tick appended, so Retry Turn can take back exactly those. */
export function tagWorldTickJournalEntries<T extends { entries: readonly object[] }>(
  before: { entries: readonly unknown[] },
  after: T,
  turnMessageId: string | undefined,
): T {
  const messageId = g.readTrimmed(turnMessageId);
  if (!messageId || after.entries.length <= before.entries.length) return after;
  return {
    ...after,
    entries: after.entries.map((entry, index) =>
      index >= before.entries.length ? { ...entry, sourceMessageId: messageId } : entry,
    ),
  };
}

/**
 * Put the clock, weather and world-tick state back to how it was before `messageId`'s reply,
 * and drop the journal recap and NPC notes its scene-end world tick wrote (everything else is kept).
 */
export async function restoreClockBaseline(data: {
  chatId: string;
  messageId: string;
}): Promise<RestoreClockBaselineResult> {
  const chat = await g.getChat(data.chatId);
  const baseline = readClockBaseline(g.chatMeta(chat).gameClockBaseline);
  if (!baseline || baseline.messageId !== g.readTrimmed(data.messageId)) {
    return { restored: false, visible: null, sessionChat: chat };
  }
  const messageId = baseline.messageId;
  const journal = g.asRecord(g.chatMeta(chat).gameJournal);
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const keptEntries = entries.filter((entry) => !isWorldTickEntryFor(entry, messageId));
  const npcs = g.chatMeta(chat).gameNpcs;
  const sessionChat = await g.patchChatMetadata(data.chatId, {
    ...baseline.metadata,
    ...(keptEntries.length !== entries.length ? { gameJournal: { ...journal, entries: keptEntries } } : {}),
    ...(baseline.tickNpcNotes.length > 0 ? { gameNpcs: withoutTickNpcNotes(npcs, baseline.tickNpcNotes) } : {}),
  });
  await worldStateApi.patch(data.chatId, baseline.visible);
  return { restored: true, visible: baseline.visible, sessionChat };
}
