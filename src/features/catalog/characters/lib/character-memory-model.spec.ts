import { describe, expect, it } from "vitest";

import type { CanonicalMemoryRecord } from "../../../../engine/contracts/types/memory";
import {
  characterMemoryImportPatch,
  characterMemoryStatusLabel,
  createManualCharacterMemoryInput,
  createCharacterMemoryExport,
  normalizeChatMemoriesForCharacter,
  normalizeCharacterMemoryImport,
} from "./character-memory-model";

describe("manual character memory", () => {
  it("creates an honestly attributed character-scoped input", () => {
    const now = "2026-07-23T15:00:00.000Z";

    expect(createManualCharacterMemoryInput(" char-1 ", "  Mira keeps the brass key.  ", now)).toEqual({
      kind: "fact",
      status: "active",
      scope: { kind: "character", id: "char-1" },
      content: "Mira keeps the brass key.",
      confidence: 1,
      provenance: {
        sourceChatId: null,
        messageIds: [],
        sceneId: null,
        characterId: "char-1",
        timestamp: now,
      },
      tags: ["manual"],
      payload: { manual: true, createdBy: "user" },
      createdAt: now,
      updatedAt: now,
    });
  });

  it("rejects missing ownership and empty content", () => {
    expect(() => createManualCharacterMemoryInput("", "Memory")).toThrow("Choose a character");
    expect(() => createManualCharacterMemoryInput("char-1", "   ")).toThrow("Memory content is required");
  });

  it("accepts one caller-owned timestamp for a batch", () => {
    const batchTimestamp = "2026-07-23T15:00:00.000Z";
    const batch = ["First memory", "Second memory"].map((content) =>
      createManualCharacterMemoryInput("char-1", content, batchTimestamp),
    );

    expect(batch.map(({ createdAt, updatedAt, provenance }) => ({
      createdAt,
      updatedAt,
      provenanceTimestamp: provenance.timestamp,
    }))).toEqual([
      {
        createdAt: batchTimestamp,
        updatedAt: batchTimestamp,
        provenanceTimestamp: batchTimestamp,
      },
      {
        createdAt: batchTimestamp,
        updatedAt: batchTimestamp,
        provenanceTimestamp: batchTimestamp,
      },
    ]);
  });
});

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

  it("rejects an envelope containing malformed memory records instead of silently skipping them", () => {
    const envelope = createCharacterMemoryExport({
      character: { id: "source-character", name: "Source Mira" },
      memories: [memory()],
      exportedAt: "2026-07-17T12:00:00.000Z",
    });
    envelope.memories.push({
      ...memory({ id: "memory-2" }),
      provenance: { messageIds: "not-an-array" },
    } as unknown as CanonicalMemoryRecord);

    expect(() =>
      normalizeCharacterMemoryImport(envelope, {
        characterId: "target-character",
        importedAt: "2026-07-17T13:00:00.000Z",
      }),
    ).toThrow("Memory 2 is malformed");
  });

  it("keeps imported tags and payload when an existing memory is patched", () => {
    const [input] = normalizeCharacterMemoryImport(
      createCharacterMemoryExport({
        character: { id: "source-character", name: "Source Mira" },
        memories: [
          memory({
            tags: ["friend", "harbor"],
            payload: { importRoot: "portable-root" },
          }),
        ],
      }),
      {
        characterId: "target-character",
        importedAt: "2026-07-17T13:00:00.000Z",
      },
    );

    expect(characterMemoryImportPatch(input!)).toEqual(
      expect.objectContaining({
        tags: ["friend", "harbor"],
        payload: expect.objectContaining({
          importRoot: "portable-root",
          importedFromMemoryId: "memory-1",
        }),
      }),
    );
    expect(characterMemoryImportPatch(input!)).not.toHaveProperty("id");
    expect(characterMemoryImportPatch(input!)).not.toHaveProperty("createdAt");
    expect(characterMemoryImportPatch(input!)).not.toHaveProperty("updatedAt");
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
