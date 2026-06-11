import * as g from "./game-api-support";
import { sessionSummary } from "./game-api-session-helpers";

const GAME_LOREBOOK_KEEPER_SOURCE_ID = "game-lorebook-keeper";

function keeperEntrySessionNumber(entry: g.LorebookEntry): number | null {
  const state = g.asRecord(entry.dynamicState);
  const value = Number(state.gameLorebookKeeperSessionNumber);
  return Number.isFinite(value) ? value : null;
}

export function gameLorebookKeeperEnabled(meta: Record<string, unknown>): boolean {
  return meta.gameLorebookKeeperEnabled === true || meta.gameEnableLorebookKeeper === true;
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
  const lorebook = await resolveGameLorebookKeeperLorebook(data.chat, data.meta);
  const normalizedEntries = data.entries.length
    ? data.entries.map((entry, index) => normalizeGameLorebookKeeperEntry(entry, data.sessionNumber, index))
    : [
        normalizeGameLorebookKeeperEntry(
          {
            name: `Session ${data.sessionNumber} Recap`,
            content: "No durable lore was generated for this concluded session.",
            keys: [`session ${data.sessionNumber}`],
          },
          data.sessionNumber,
          0,
        ),
      ];
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
    const fallbackEntries = [
      {
        name: `Session ${data.sessionNumber} Recap`,
        content: data.summary.summary || transcript.split("\n").slice(-12).join("\n"),
        keys: [`session ${data.sessionNumber}`, "recap", "campaign"],
      },
    ];
    const parsed =
      data.generated ??
      (await g.llmJson({
        connectionId: data.connectionId,
        fallback: { entries: fallbackEntries },
        system:
          "Extract durable game campaign lore from this concluded session. Return strict JSON with an entries array; each entry has name, content, keys array, and optional tag.",
        user: [
          `Session number: ${data.sessionNumber}`,
          ``,
          `Session summary:`,
          JSON.stringify(data.summary, null, 2),
          ``,
          `Session transcript:`,
          transcript,
        ].join("\n"),
        parameters: { temperature: 0.3, maxTokens: 2500 },
        repair: {
          kind: "session_lorebook",
          title: `Repair Session ${data.sessionNumber} Lorebook JSON`,
          applyBody: {
            chatId: data.chat.id,
            sessionNumber: data.sessionNumber,
            connectionId: data.connectionId,
          },
        },
      }));
    const entries = Array.isArray(parsed.entries) && parsed.entries.length ? parsed.entries : fallbackEntries;
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
  const summaries = Array.isArray(meta.gamePreviousSessionSummaries)
    ? (meta.gamePreviousSessionSummaries as g.SessionSummary[])
    : [];
  const summary =
    summaries.find((item) => item.sessionNumber === data.sessionNumber) ??
    sessionSummary(data.sessionNumber, chat, meta);
  const keeperRun = await runGameLorebookKeeperAfterConclusion({
    chat,
    meta: { ...meta, gameLorebookKeeperEnabled: true },
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
