import { describe, expect, it } from "vitest";

import type { CanonicalMemoryRecord, MemoryKind, MemoryScopeKind, MemoryStatus } from "./memory";

const kinds: MemoryKind[] = [
  "episode",
  "fact",
  "scene_event",
  "relationship_state",
  "preference",
  "promise",
  "plot_state",
  "contradiction",
  "lore",
  "summary",
];
const statuses: MemoryStatus[] = ["active", "superseded", "stale", "pinned", "deleted"];
const scopes: MemoryScopeKind[] = ["user", "character", "chat", "scene", "world", "agent"];

describe("canonical memory contracts", () => {
  it("covers every memory kind, status, scope, and provenance field", () => {
    const records = kinds.map(
      (kind, index) =>
        ({
          id: `memory-${kind}`,
          kind,
          status: statuses[index % statuses.length],
          scope: { kind: scopes[index % scopes.length], id: `${scopes[index % scopes.length]}-1` },
          content: `${kind} content`,
          confidence: 0.75,
          title: `${kind} title`,
          tags: [kind],
          provenance: {
            sourceChatId: "chat-1",
            messageIds: ["message-1", "message-2"],
            sceneId: "scene-1",
            characterId: "character-1",
            timestamp: "2026-07-04T12:00:00.000Z",
          },
          supersedesMemoryId: index === 0 ? null : "older-memory",
          supersededByMemoryId: null,
          payload: { note: kind },
          createdAt: "2026-07-04T12:00:00.000Z",
          updatedAt: "2026-07-04T12:00:00.000Z",
        }) satisfies CanonicalMemoryRecord,
    );

    expect(records.map((record) => record.kind)).toEqual(kinds);
    expect(records[0].provenance.messageIds).toEqual(["message-1", "message-2"]);
  });
});