import * as g from "./game-api-support";
import { generateStructured } from "../../../../engine/generation/structured-generation";
import {
  GAME_LORE_EXTRACTION_SCHEMA_DESCRIPTION,
  gameLoreExtractionStructuredSchema,
} from "../../../../engine/modes/game/lorebook/game-lore-extraction.schema";

const GAME_LOREBOOK_KEEPER_SOURCE_ID = "game-lorebook-keeper";
const GAME_LOREBOOK_KEEPER_FAILURE_MESSAGE =
  "Game Lorebook Keeper did not return usable structured lore. Nothing was written; try again or choose a different model.";

function keeperEntrySessionNumber(entry: g.LorebookEntry): number | null {
  const state = g.asRecord(entry.dynamicState);
  const value = Number(state.gameLorebookKeeperSessionNumber);
  return Number.isFinite(value) ? value : null;
}

export function gameLorebookKeeperEnabled(meta: Record<string, unknown>): boolean {
  return meta.gameLorebookKeeperEnabled === true || meta.gameEnableLorebookKeeper === true;
}

function requireStoredSessionSummary(
  chat: g.Chat,
  meta: Record<string, unknown>,
  sessionNumber: number,
): g.SessionSummary {
  if (g.readTrimmed(chat.mode) !== "game") {
    throw new Error("Game Lorebook Keeper can only regenerate game chats.");
  }
  if (!gameLorebookKeeperEnabled(meta)) {
    throw new Error("Game Lorebook Keeper is disabled for this chat.");
  }
  const summaries = Array.isArray(meta.gamePreviousSessionSummaries)
    ? (meta.gamePreviousSessionSummaries as g.SessionSummary[])
    : [];
  const summary = summaries.find((item) => item.sessionNumber === sessionNumber);
  if (!summary) {
    throw new Error(`Stored session ${sessionNumber} summary was not found.`);
  }
  return summary;
}

function normalizeGameLorebookKeeperEntry(
  rawEntry: unknown,
  sessionNumber: number,
  index: number,
): Record<string, unknown> {
  const entry = g.asRecord(rawEntry);
  const name = g.readTrimmed(entry.name) || `Session ${sessionNumber} Lore ${index + 1}`;
  const content =
    g.readTrimmed(entry.content) || g.readTrimmed(entry.description) || "No durable session detail was provided.";
  const keys = Array.isArray(entry.keys)
    ? entry.keys.map((key) => g.readTrimmed(key)).filter(Boolean)
    : [`session ${sessionNumber}`];
  const tag = g.readTrimmed(entry.tag) || `game-session-${sessionNumber}`;
  return {
    name,
    content,
    keys: keys.length ? keys : [`session ${sessionNumber}`],
    secondaryKeys: [],
    enabled: true,
    constant: false,
    selective: false,
    order: index,
    sortOrder: index,
    position: 0,
    role: "system",
    tag,
    dynamicState: {
      ...g.asRecord(entry.dynamicState),
      gameLorebookKeeperSessionNumber: sessionNumber,
      gameLorebookKeeperUpdatedAt: g.nowIso(),
    },
    excludeFromVectorization: false,
  };
}

function validateGameLorebookExtraction(value: unknown): Record<string, unknown> {
  const result = gameLoreExtractionStructuredSchema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(GAME_LOREBOOK_KEEPER_FAILURE_MESSAGE);
}

async function generateGameLorebookExtraction(input: {
  sessionNumber: number;
  summary: g.SessionSummary;
  transcript: string;
  connectionId?: string | null;
}): Promise<Record<string, unknown>> {
  if (!input.connectionId) {
    throw new Error("Choose a model connection before running Game Lorebook Keeper.");
  }

  const result = await generateStructured(
    { llm: g.llmApi },
    {
      taskName: "game.session_lorebook",
      connectionId: input.connectionId,
      messages: [
        {
          role: "system",
          content:
            "Extract durable game campaign lore from this concluded session. Return strict JSON with an entries array; each entry has name, content, keys array, and optional tag.",
        },
        {
          role: "user",
          content: [
            `Session number: ${input.sessionNumber}`,
            ``,
            `Session summary:`,
            JSON.stringify(input.summary, null, 2),
            ``,
            `Session transcript:`,
            input.transcript,
          ].join("\n"),
        },
      ],
      parameters: { temperature: 0.3, maxTokens: 2500 },
      schema: gameLoreExtractionStructuredSchema,
      schemaDescription: GAME_LORE_EXTRACTION_SCHEMA_DESCRIPTION,
      maxRepairAttempts: 1,
      failureMessage: GAME_LOREBOOK_KEEPER_FAILURE_MESSAGE,
    },
  );
  if (!result.ok) throw new Error(GAME_LOREBOOK_KEEPER_FAILURE_MESSAGE);
  return result.data;
}

async function resolveGameLorebookKeeperLorebook(chat: g.Chat, meta: Record<string, unknown>): Promise<g.Lorebook> {
  const existingId = g.readTrimmed(meta.gameLorebookKeeperLorebookId);
  if (existingId) {
    const existing = await g.storageApi.get<g.Lorebook>("lorebooks", existingId).catch(() => null);
    if (existing) return existing;
  }

  const lorebook = await g.storageApi.create<g.Lorebook>(
    "lorebooks",
    g.createLorebookSchema.parse({
      name: `${chat.name || "Game"} Lorebook`,
      description: "Maintained automatically from concluded game sessions.",
      category: "game",
      chatId: chat.id,
      enabled: true,
      generatedBy: "game-session",
      sourceAgentId: GAME_LOREBOOK_KEEPER_SOURCE_ID,
    }),
  );
  return lorebook;
}

async function writeGameLorebookKeeperEntries(data: {
  chat: g.Chat;
  meta: Record<string, unknown>;
  sessionNumber: number;
  entries: unknown[];
}): Promise<{ lorebookId: string; entryCount: number; sessionChat: g.Chat }> {
  if (data.entries.length === 0) {
    throw new Error(GAME_LOREBOOK_KEEPER_FAILURE_MESSAGE);
  }
  const lorebook = await resolveGameLorebookKeeperLorebook(data.chat, data.meta);
  const normalizedEntries = data.entries.map((entry, index) =>
    normalizeGameLorebookKeeperEntry(entry, data.sessionNumber, index),
  );
  const entriesToCreate = normalizedEntries.map((entry) =>
    g.createLorebookEntrySchema.parse({
      ...entry,
      lorebookId: lorebook.id,
      enabled: false,
      dynamicState: { ...g.asRecord(entry.dynamicState), gameLorebookKeeperPending: true },
    }),
  );

  const createdEntries: g.LorebookEntry[] = [];
  const disableCreatedEntries = () =>
    Promise.all(
      createdEntries.map((entry) =>
        g.storageApi
          .update(
            "lorebook-entries",
            entry.id,
            g.updateLorebookEntrySchema.parse({
              enabled: false,
              dynamicState: {
                ...g.asRecord(entry.dynamicState),
                gameLorebookKeeperPending: true,
                gameLorebookKeeperFinalizationFailedAt: g.nowIso(),
              },
            }),
          )
          .catch(() => null),
      ),
    );
  try {
    for (const entry of entriesToCreate) {
      createdEntries.push(await g.storageApi.create<g.LorebookEntry>("lorebook-entries", entry));
    }
  } catch (error) {
    await Promise.all(
      createdEntries.map((entry) => g.storageApi.delete("lorebook-entries", entry.id).catch(() => null)),
    );
    throw error;
  }

  const existingEntries = await g.storageApi.list<g.LorebookEntry>("lorebook-entries", {
    filters: { lorebookId: lorebook.id },
  });
  const createdEntryIds = new Set(createdEntries.map((entry) => entry.id));
  const staleEntries = existingEntries.filter(
    (entry) => !createdEntryIds.has(entry.id) && keeperEntrySessionNumber(entry) === data.sessionNumber,
  );
  const restoreStaleEntries = () =>
    Promise.all(
      staleEntries.map((entry) =>
        g.storageApi
          .update(
            "lorebook-entries",
            entry.id,
            g.updateLorebookEntrySchema.parse({
              enabled: entry.enabled,
              dynamicState: g.asRecord(entry.dynamicState),
            }),
          )
          .catch(() => null),
      ),
    );
  let sessionChat: g.Chat;
  try {
    for (const entry of staleEntries) {
      await g.storageApi.update(
        "lorebook-entries",
        entry.id,
        g.updateLorebookEntrySchema.parse({
          enabled: false,
          dynamicState: {
            ...g.asRecord(entry.dynamicState),
            gameLorebookKeeperSupersededAt: g.nowIso(),
          },
        }),
      );
      const staleEntry = await g.storageApi.get<g.LorebookEntry>("lorebook-entries", entry.id);
      if (!staleEntry || staleEntry.enabled === true) {
        throw new Error(`Game Lorebook Keeper stale entry was not confirmed inactive: ${entry.id}`);
      }
    }
    for (const entry of createdEntries) {
      await g.storageApi.update(
        "lorebook-entries",
        entry.id,
        g.updateLorebookEntrySchema.parse({
          enabled: true,
          dynamicState: {
            ...g.asRecord(entry.dynamicState),
            gameLorebookKeeperPending: false,
            gameLorebookKeeperCommittedAt: g.nowIso(),
          },
        }),
      );
    }
    sessionChat = await g.patchChatMetadata(data.chat.id, {
      gameLorebookKeeperLorebookId: lorebook.id,
      activeLorebookIds: Array.from(
        new Set([
          ...(Array.isArray(data.meta.activeLorebookIds)
            ? data.meta.activeLorebookIds.filter((id): id is string => typeof id === "string")
            : []),
          lorebook.id,
        ]),
      ),
      gameLorebookKeeperLastRun: {
        sessionNumber: data.sessionNumber,
        status: "success",
        updatedAt: g.nowIso(),
        lorebookId: lorebook.id,
        entryCount: entriesToCreate.length,
      },
    });
  } catch (error) {
    await restoreStaleEntries();
    await disableCreatedEntries();
    throw error;
  }

  for (const entry of staleEntries) {
    try {
      await g.storageApi.delete("lorebook-entries", entry.id);
    } catch (error) {
      console.warn("[game] Game Lorebook Keeper stale entry cleanup failed", { entryId: entry.id, error });
    }
  }
  return { lorebookId: lorebook.id, entryCount: entriesToCreate.length, sessionChat };
}

export async function runGameLorebookKeeperAfterConclusion(data: {
  chat: g.Chat;
  meta: Record<string, unknown>;
  sessionNumber: number;
  summary: g.SessionSummary;
  connectionId?: string;
  generated?: Record<string, unknown>;
  propagateRepairErrors?: boolean;
}): Promise<{ lorebookId: string | null; entryCount?: number; sessionChat: g.Chat }> {
  const startedAt = g.nowIso();
  await g.patchChatMetadata(data.chat.id, {
    gameLorebookKeeperLastRun: {
      sessionNumber: data.sessionNumber,
      status: "running",
      updatedAt: startedAt,
      lorebookId: g.readTrimmed(data.meta.gameLorebookKeeperLorebookId) || null,
    },
  });

  try {
    const transcript = await g.sessionTranscript(data.chat.id, 160);
    const parsed = data.generated
      ? validateGameLorebookExtraction(data.generated)
      : await generateGameLorebookExtraction({
          sessionNumber: data.sessionNumber,
          summary: data.summary,
          transcript,
          connectionId: data.connectionId,
        });
    const entries = parsed.entries as unknown[];
    return await writeGameLorebookKeeperEntries({
      chat: data.chat,
      meta: data.meta,
      sessionNumber: data.sessionNumber,
      entries,
    });
  } catch (error) {
    const lorebookId = g.readTrimmed(data.meta.gameLorebookKeeperLorebookId) || null;
    const sessionChat = await g.patchChatMetadata(data.chat.id, {
      gameLorebookKeeperLastRun: {
        sessionNumber: data.sessionNumber,
        status: "failed",
        updatedAt: g.nowIso(),
        lorebookId,
        error: error instanceof Error ? error.message : "Game Lorebook Keeper failed.",
      },
    });
    if (data.propagateRepairErrors && g.isJsonRepairApiError(error)) {
      throw error;
    }
    if (
      data.propagateRepairErrors &&
      error instanceof Error &&
      (error.message === GAME_LOREBOOK_KEEPER_FAILURE_MESSAGE ||
        error.message === "Choose a model connection before running Game Lorebook Keeper.")
    ) {
      throw error;
    }
    return { lorebookId, sessionChat };
  }
}

export async function regenerateSessionLorebook(data: {
  chatId: string;
  sessionNumber: number;
  connectionId?: string;
  generated?: Record<string, unknown>;
}): Promise<g.RegenerateSessionLorebookResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const summary = requireStoredSessionSummary(chat, meta, data.sessionNumber);
  const keeperRun = await runGameLorebookKeeperAfterConclusion({
    chat,
    meta,
    sessionNumber: data.sessionNumber,
    summary,
    connectionId: data.connectionId,
    generated: data.generated,
    propagateRepairErrors: true,
  });
  if (keeperRun.entryCount === undefined || !keeperRun.lorebookId) {
    throw new Error("Game Lorebook Keeper failed to regenerate this session.");
  }
  return {
    sessionNumber: data.sessionNumber,
    lorebookId: keeperRun.lorebookId,
    entryCount: keeperRun.entryCount,
    sessionChat: keeperRun.sessionChat,
  };
}
