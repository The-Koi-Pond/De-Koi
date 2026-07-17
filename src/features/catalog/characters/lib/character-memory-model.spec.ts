import { describe, expect, it } from "vitest";

import type { CanonicalMemoryRecord } from "../../../../engine/contracts/types/memory";
import {
  characterMemoryStatusLabel,
  createCharacterMemoryExport,
  normalizeChatMemoriesForCharacter,
  normalizeCharacterMemoryImport,
} from "./character-memory-model";

function memory(overrides: Partial<CanonicalMemoryRecord> = {}): CanonicalMemoryRecord {
  return {
    id: "memory-1",
    kind: "fact",
    status: "active",
    scope: { kind: "character", id: "source-character" },
    content: "Mira remembers Miso.",
    confidence: 0.9,
    provenance: {
      sourceChatId: "chat-1",
      messageIds: ["message-1"],
      characterId: "source-character",
      timestamp: "2026-07-01T10:00:00.000Z",
    },
    tags: ["automatic"],
    payload: {
      automatic: true,
      vector: [0.1, 0.2],
      provider: "openai",
      model: "embedding-model",
      nested: { embedding: [0.3], keep: "yes" },
    },
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("character memory export", () => {
  it("exports a portable v1 envelope without provider or index projections", () => {
    const exported = createCharacterMemoryExport({
      character: { id: "char-1", name: "Mira" },
      memories: [memory()],
      exportedAt: "2026-07-17T12:00:00.000Z",
    });

    expect(exported).toEqual(
      expect.objectContaining({
        type: "de_koi_character_memories",
        version: 1,
        exportedAt: "2026-07-17T12:00:00.000Z",
        character: { id: "char-1", name: "Mira" },
      }),
    );
    expect(exported.memories[0]?.payload).toEqual({
      automatic: true,
      nested: { keep: "yes" },
    });
  });
});

describe("character memory import", () => {
  it("rewrites scope to the selected character and uses stable migration IDs", () => {
    const envelope = createCharacterMemoryExport({
      character: { id: "source-character", name: "Source Mira" },
      memories: [memory()],
      exportedAt: "2026-07-17T12:00:00.000Z",
    });

    const first = normalizeCharacterMemoryImport(envelope, {
      characterId: "target-character",
      importedAt: "2026-07-17T13:00:00.000Z",
    });
    const second = normalizeCharacterMemoryImport(envelope, {
      characterId: "target-character",
      importedAt: "2026-07-18T13:00:00.000Z",
    });

    expect(first).toHaveLength(1);
    expect(first[0]).toEqual(
      expect.objectContaining({
        id: second[0]?.id,
        scope: { kind: "character", id: "target-character" },
        status: "active",
        provenance: expect.objectContaining({
          sourceChatId: "chat-1",
          messageIds: ["message-1"],
          characterId: "target-character",
        }),
        payload: expect.objectContaining({
          importedFromMemoryId: "memory-1",
          importedFromCharacterId: "source-character",
        }),
      }),
    );
  });

  it("rejects non-character-memory envelopes", () => {
    expect(() =>
      normalizeCharacterMemoryImport({ type: "other", version: 1 }, {
        characterId: "target-character",
        importedAt: "2026-07-17T13:00:00.000Z",
      }),
    ).toThrow("De-Koi character memories v1");
  });
});

describe("character memory labels", () => {
  it("uses human status labels", () => {
    expect(characterMemoryStatusLabel("active")).toBe("Active");
    expect(characterMemoryStatusLabel("pinned")).toBe("Pinned");
    expect(characterMemoryStatusLabel("deleted")).toBe("Deleted");
    expect(characterMemoryStatusLabel("superseded")).toBe("Superseded");
  });
});

describe("chat memory copy", () => {
  it("creates stable character-scoped inputs without mutating the chat row", () => {
    const source = {
      id: "chat-memory-1",
      chatId: "chat-1",
      content: "Mira promised to remember the blue lantern.",
      messageIds: ["message-1", "message-2"],
      lastMessageAt: "2026-07-02T10:00:00.000Z",
    };

    const [copied] = normalizeChatMemoriesForCharacter([source], {
      characterId: "char-1",
      copiedAt: "2026-07-17T13:00:00.000Z",
    });

    expect(copied).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^character-memory-copy-/),
        scope: { kind: "character", id: "char-1" },
        content: source.content,
        provenance: expect.objectContaining({
          sourceChatId: "chat-1",
          messageIds: ["message-1", "message-2"],
          characterId: "char-1",
        }),
      }),
    );
    expect(source).not.toHaveProperty("scope");
  });
});
