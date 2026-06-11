import { describe, expect, it } from "vitest";
import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { AgentDebugEntry } from "../../../contracts/types/agent";
import type { EncounterSettings } from "../../../contracts/types/combat-encounter";
import { initRoleplayEncounter } from "./encounter-service";

const settings: EncounterSettings = {
  historyDepth: 2,
  combatNarrative: {
    tense: "present",
    person: "second",
    narration: "limited",
    pov: "Player",
  },
  summaryNarrative: {
    tense: "past",
    person: "third",
    narration: "limited",
    pov: "Player",
  },
};

function createStorage(): StorageGateway {
  return {
    async list<T = unknown>(entity: Parameters<StorageGateway["list"]>[0]) {
      if (entity === "personas") return [{ id: "persona-1", name: "Celia", isActive: true }] as T[];
      if (entity === "connections") return [{ id: "conn-1", isDefault: true }] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: Parameters<StorageGateway["get"]>[0], id: string) {
      if (entity === "chats" && id === "chat-1") {
        return { id: "chat-1", personaId: "persona-1", connectionId: "conn-1" } as T;
      }
      if (entity === "connections" && id === "conn-1") return { id: "conn-1" } as T;
      return null;
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async delete() {
      throw new Error("not implemented");
    },
    async listChatMessages<T = unknown>() {
      return [{ role: "user", content: "A shadow blocks the road." }] as T[];
    },
    async createChatMessage() {
      throw new Error("not implemented");
    },
    async updateChatMessage() {
      throw new Error("not implemented");
    },
    async deleteChatMessage() {
      throw new Error("not implemented");
    },
    async patchChatMessageExtra() {
      throw new Error("not implemented");
    },
    async addChatMessageSwipe() {
      throw new Error("not implemented");
    },
    async patchChatMetadata() {
      throw new Error("not implemented");
    },
    async patchChatSummaries() {
      throw new Error("not implemented");
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState<T = unknown>() {
      return {} as T;
    },
    async saveTrackerSnapshot() {
      throw new Error("not implemented");
    },
    async listLorebookEntries() {
      return [];
    },
    async createLorebookEntries() {
      throw new Error("not implemented");
    },
    async promptFull() {
      return null;
    },
  };
}

function createLlm(): LlmGateway {
  return {
    async complete() {
      return JSON.stringify({
        combatState: {
          party: [
            {
              name: "Celia",
              hp: 24,
              maxHp: 24,
              attacks: [{ name: "Strike", type: "single-target" }],
              items: [],
              statuses: [],
              isPlayer: true,
            },
          ],
          enemies: [
            {
              name: "Road Warden",
              hp: 18,
              maxHp: 18,
              attacks: [{ name: "Spear", type: "single-target" }],
              statuses: [],
              description: "A stern guardian.",
              sprite: "enemy",
            },
          ],
          environment: "A moonlit road.",
          styleNotes: {
            environmentType: "road",
            atmosphere: "tense",
            timeOfDay: "night",
            weather: "clear",
          },
        },
      });
    },
    async *stream() {
      yield { type: "done" as const };
    },
    async listModels() {
      return [];
    },
  };
}

describe("initRoleplayEncounter", () => {
  it("emits request, raw response, and parsed response debug diagnostics when debug mode is enabled", async () => {
    const entries: Array<Omit<AgentDebugEntry, "timestamp"> & { timestamp?: number }> = [];

    const result = await initRoleplayEncounter(
      { storage: createStorage(), llm: createLlm() },
      {
        chatId: "chat-1",
        connectionId: null,
        settings,
        debugMode: true,
        debugSink: (entry) => entries.push(entry),
      },
    );

    expect(result.combatState.enemies[0]?.name).toBe("Road Warden");
    expect(entries.map((entry) => entry.message)).toEqual([
      "[debug/roleplay/encounter:init] request",
      "[debug/roleplay/encounter:init] raw response",
      "[debug/roleplay/encounter:init] parsed response",
    ]);
    expect(entries.every((entry) => entry.level === "debug" && entry.phase === "roleplay-encounter-init")).toBe(true);
  });
});
